"""Tests de la Veille prix : calculs, règles, score, service par mot-clé."""
from app.pricewatch import scoring


def test_compute_discount():
    assert scoring.compute_discount(149.99, 89.99) == (60.0, 40.0)
    assert scoring.compute_discount(100, 100) == (0.0, 0.0)
    assert scoring.compute_discount(None, 50) == (None, None)
    assert scoring.compute_discount(0, 50) == (None, None)


def test_is_suspicious():
    cfg = {"suspiciousMinPrice": 1.0, "suspiciousMaxDiscountPercent": 95}
    assert scoring.is_suspicious(100, 0.5, 99.5, cfg) is True     # prix < 1€
    assert scoring.is_suspicious(100, 3, 97, cfg) is True         # -97% aberrant
    assert scoring.is_suspicious(100, 60, 40, cfg) is False       # normal


def test_passes_rules():
    cfg = {"minDiscountPercent": 20, "minDiscountAmount": 10,
           "ignoreOutOfStock": True}
    assert scoring.passes_rules(40, 60, True, False, cfg) is True
    assert scoring.passes_rules(15, 60, True, False, cfg) is False   # < 20%
    assert scoring.passes_rules(40, 5, True, False, cfg) is False    # < 10€
    assert scoring.passes_rules(40, 60, False, False, cfg) is False  # rupture
    assert scoring.passes_rules(40, 60, True, True, cfg) is False    # suspect


def test_classify_alert():
    cfg = {"minDiscountPercent": 20, "alertPercent": 30, "urgentPercent": 50}
    assert scoring.classify_alert(55, cfg) == "baisse-urgente"
    assert scoring.classify_alert(35, cfg) == "baisse-forte"
    assert scoring.classify_alert(22, cfg) == "baisse"
    assert scoring.classify_alert(10, cfg) is None


def test_opportunity_score_ordering():
    strong = scoring.opportunity_score(60, 120, True, True, True, 5)
    weak = scoring.opportunity_score(21, 12, False, False, False, 0)
    assert strong > weak
    assert 0 <= weak <= 100 and 0 <= strong <= 100


def test_example_from_spec():
    # Aspirateur : 149,99 -> 89,99 = -60€ / -40%
    amount, percent = scoring.compute_discount(149.99, 89.99)
    assert amount == 60.0 and percent == 40.0
    cfg = {"minDiscountPercent": 20, "minDiscountAmount": 10,
           "ignoreOutOfStock": True, "suspiciousMinPrice": 1.0,
           "suspiciousMaxDiscountPercent": 95, "alertPercent": 30,
           "urgentPercent": 50}
    assert scoring.passes_rules(percent, amount, True, False, cfg) is True
    assert scoring.classify_alert(percent, cfg) == "baisse-forte"


def test_deal_parser_extracts_prices():
    from app.pricewatch.deals import parse_deal
    d = parse_deal("Casque Sony WH-1000XM5 à 279€ au lieu de 349€ (-20%) chez Amazon", "")
    assert d["price"] == 279.0 and d["old_price"] == 349.0
    assert d["discount_percent"] == 20.0 and d["merchant"] == "Amazon"
    # calcul du % quand il n'est pas écrit
    d2 = parse_deal("TV LG à 900€ au lieu de 1500€ sur Cdiscount", "")
    assert d2["old_price"] == 1500.0 and d2["price"] == 900.0
    assert d2["discount_percent"] == 40.0 and d2["merchant"] == "Cdiscount"
    # rien d'exploitable
    assert parse_deal("Un article sympa", "") is None


def test_deal_harvest_filters(monkeypatch):
    import app.pricewatch.deals as deals
    monkeypatch.setattr(deals, "load_feeds",
                        lambda: [{"name": "F1", "url": "http://x", "enabled": True}])
    monkeypatch.setattr(deals, "fetch_rss_items", lambda url, n: ([
        {"title": "PS5 à 400€ au lieu de 550€ (-27%) Amazon", "link": "u1", "description": ""},
        {"title": "Cable à 9€ au lieu de 10€ (-10%) Cdiscount", "link": "u2", "description": ""},
    ], "ok"))
    res = deals.harvest(min_discount=20)
    assert res["count"] == 1                    # seul -27% passe (>=20%)
    assert res["deals"][0]["discount_percent"] == 27.0
    # flux mort -> non disponible, pas de crash
    monkeypatch.setattr(deals, "fetch_rss_items", lambda url, n: ([], "http_403"))
    res2 = deals.harvest()
    assert res2["per_feed"][0]["status"] == "non_disponible"


def test_repricing_recommendations():
    from app.pricewatch import repricing
    cfg = {"alignThresholdPercent": 3, "raiseThresholdPercent": 10,
           "undercutPercent": 1}
    # Je suis bien plus cher -> baisser
    r = repricing.recommend(349.0, 279.99, cfg)
    assert r["action"] == "baisser" and r["target"] < 279.99
    # Je suis bien moins cher -> augmenter (marge)
    r = repricing.recommend(1290.0, 1490.0, cfg)
    assert r["action"] == "augmenter"
    # Aligné -> ok
    r = repricing.recommend(100.0, 100.5, cfg)
    assert r["action"] == "ok"
    # Donnée manquante
    assert repricing.recommend(None, 100.0, cfg)["action"] == "donnees_manquantes"


def test_repricing_parse_csv_and_analyze():
    from app.pricewatch import repricing
    csv_bytes = ("Produit;EAN;Mon prix;Prix concurrent;Site concurrent\n"
                 "Casque;4548736132566;349,00;279,99;Amazon\n"
                 "TV;8806091985702;1290,00;1490,00;Boulanger\n"
                 "PS5;071;549,00;499,00;Cdiscount\n").encode("utf-8-sig")
    cfg = {"alignThresholdPercent": 3, "raiseThresholdPercent": 10,
           "undercutPercent": 1}
    res = repricing.analyze(csv_bytes, "produits.csv", cfg)
    assert res["ok"] and res["count"] == 3
    # colonnes bien détectées (accents/casse/; gérés)
    assert res["mapping"]["my_price"] == "Mon prix"
    assert res["mapping"]["competitor_price"] == "Prix concurrent"
    # tri par plus gros écart : la TV (-13%) ou casque (+25%) en tête
    actions = {r["name"]: r["action"] for r in res["rows"]}
    assert actions["Casque"] == "baisser"
    assert actions["TV"] == "augmenter"
    assert res["counts"]["baisser"] >= 1 and res["counts"]["augmenter"] >= 1


def test_keyword_deals_filters_and_ranks(monkeypatch):
    """Le service ne garde que les vraies baisses et les classe par score."""
    import app.pricewatch.keyword as kw
    from app.apiconnectors.base import APIOffer

    class FakeConn:
        name = "ebay_api"; label = "eBay"; configured = True
        def search(self, q, n):
            return [
                APIOffer(source="ebay_api", title="TV 4K", price=300.0,
                         old_price=600.0, availability="in_stock"),   # -50%
                APIOffer(source="ebay_api", title="TV mini", price=95.0,
                         old_price=100.0, availability="in_stock"),   # -5% (rejeté)
                APIOffer(source="ebay_api", title="TV sans promo", price=200.0,
                         availability="in_stock"),                    # pas de baisse
            ]
    monkeypatch.setattr(kw.api, "price_sources", lambda: [FakeConn()])
    monkeypatch.setattr(kw, "keyword_search",
                        lambda *a, **k: {"results": [], "per_site": []})
    monkeypatch.setattr(kw, "get_config", lambda db: {
        "minDiscountPercent": 20, "minDiscountAmount": 10,
        "ignoreOutOfStock": True, "suspiciousMinPrice": 1.0,
        "suspiciousMaxDiscountPercent": 95, "alertPercent": 30,
        "urgentPercent": 50})
    res = kw.keyword_deals(db=None, query="TV", max_per_source=10)
    assert res["count"] == 1                          # seule la -50% passe
    assert res["deals"][0]["discount_percent"] == 50.0
    assert res["deals"][0]["level"] == "baisse-urgente"
