"""Tests des connecteurs d'API (hors ligne : réponses HTTP simulées).
On ne fait aucun appel réseau ; on remplace `_get`/`_request` par des stubs.
"""
from app import apiconnectors as api
from app.services.comparison import compare_offers


# ------------------------------------------------------------------- registry
def test_registry_has_all_apis():
    names = {c.name for c in api.all_api_connectors()}
    for expected in ("openfoodfacts", "openbeautyfacts", "openpetfoodfacts",
                     "openproductsfacts", "upcitemdb", "barcodelookup",
                     "ebay_api", "amazon_api", "aliexpress_api",
                     "google_merchant", "nominatim", "overpass"):
        assert expected in names


def test_price_and_catalog_split():
    price = {c.name for c in api.price_sources()}
    assert {"ebay_api", "amazon_api", "aliexpress_api"} <= price


def test_key_gated_connectors_report_unconfigured(monkeypatch):
    # Sans variables d'env, les connecteurs à clé sont "non configurés"
    for name in ("ebay_api", "amazon_api", "aliexpress_api", "barcodelookup"):
        monkeypatch.delenv("EBAY_CLIENT_ID", raising=False)
        c = api.by_name(name)
        assert c.configured is False
        assert c.search("test") == []      # ne tente aucun appel réseau


# ---------------------------------------------------------------- Open*Facts
OFF_PAYLOAD = {
    "status": 1, "code": "3017620422003",
    "product": {"product_name": "Nutella", "brands": "Ferrero",
                "categories": "Pâtes à tartiner, Petit-déjeuner",
                "image_url": "https://img/nutella.jpg",
                "generic_name": "Pâte à tartiner"},
}


def test_openfoodfacts_lookup(monkeypatch):
    off = api.by_name("openfoodfacts")
    monkeypatch.setattr(off, "_get", lambda *a, **k: OFF_PAYLOAD)
    p = off.lookup("3017620422003")
    assert p.name == "Nutella"
    assert p.brand == "Ferrero"
    assert p.category == "Pâtes à tartiner"
    assert p.ean == "3017620422003"


# ------------------------------------------------------------------ UPCitemDB
UPC_PAYLOAD = {"items": [{
    "ean": "0885909950805", "title": "Apple iPhone", "brand": "Apple",
    "category": "Electronics", "images": ["https://img/iphone.jpg"],
    "offers": [
        {"merchant": "ShopA", "price": 799.0, "currency": "EUR",
         "link": "https://a", "condition": "New", "availability": "In Stock"},
        {"merchant": "ShopB", "price": 749.0, "currency": "EUR",
         "link": "https://b", "condition": "New"},
    ]}]}


def test_upcitemdb_search(monkeypatch):
    upc = api.by_name("upcitemdb")
    monkeypatch.setattr(upc, "_get", lambda *a, **k: UPC_PAYLOAD)
    offers = upc.search("iphone")
    assert len(offers) == 2
    assert {o.seller for o in offers} == {"ShopA", "ShopB"}
    assert offers[0].brand == "Apple"


# ----------------------------------------------------------------------- eBay
EBAY_PAYLOAD = {"itemSummaries": [
    {"title": "PS5 Slim", "price": {"value": "480.00", "currency": "EUR"},
     "image": {"imageUrl": "https://img/ps5.jpg"},
     "seller": {"username": "gamerstore"}, "itemWebUrl": "https://ebay/ps5",
     "condition": "New"},
]}


def test_ebay_search(monkeypatch):
    ebay = api.by_name("ebay_api")
    monkeypatch.setenv("EBAY_CLIENT_ID", "id")       # rend configured=True
    monkeypatch.setenv("EBAY_CLIENT_SECRET", "secret")
    monkeypatch.setattr(ebay, "_get_token", lambda: "TOKEN")
    monkeypatch.setattr(ebay, "_get", lambda *a, **k: EBAY_PAYLOAD)
    offers = ebay.search("ps5")
    assert len(offers) == 1
    assert offers[0].price == 480.0
    assert offers[0].seller == "gamerstore"
    assert offers[0].currency == "EUR"


# ------------------------------------------------------------------ comparaison
def test_compare_offers_math():
    from app.apiconnectors.base import APIOffer
    offers = [
        APIOffer(source="a", title="X", price=100.0, seller="A"),
        APIOffer(source="b", title="X", price=80.0, seller="B"),
        APIOffer(source="c", title="X", price=120.0, seller="C"),
        APIOffer(source="d", title="X", price=None, seller="D"),  # sans prix
    ]
    r = compare_offers(offers)
    s = r["stats"]
    assert s["count"] == 4 and s["count_priced"] == 3
    assert s["min_price"] == 80.0 and s["max_price"] == 120.0
    assert s["avg_price"] == 100.0
    assert s["potential_saving"] == 40.0          # 120 - 80
    assert s["spread_percent"] == 33.3            # (120-80)/120
    assert s["best_offer"]["seller"] == "B"
    # tri : le moins cher d'abord, les sans-prix à la fin
    assert r["offers"][0]["price"] == 80.0
    assert r["offers"][-1]["price"] is None


def test_amazon_signing_runs(monkeypatch):
    """La signature SigV4 doit se calculer sans erreur (sans réseau)."""
    amazon = api.by_name("amazon_api")
    monkeypatch.setattr(api.by_name("amazon_api"), "name", "amazon_api")
    import app.config as cfg
    cfg.settings.AMAZON_SECRET_KEY = "secret"
    cfg.settings.AMAZON_ACCESS_KEY = "AKIA"
    headers = amazon._signed_headers('{"Keywords":"x"}')
    assert headers["Authorization"].startswith("AWS4-HMAC-SHA256")
    assert "Signature=" in headers["Authorization"]
