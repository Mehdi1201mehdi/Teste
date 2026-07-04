"""Tests automatisés du framework de connecteurs et de l'extraction.

Ils s'exécutent hors ligne (aucune requête réseau) sur des fragments HTML
représentatifs. Lancer : pytest -q
"""
from app import connectors
from app.connectors.linkextract import extract_product_links
from app.scraping.extractor import extract_product, parse_price

# --- Fiche produit type (schema.org/Product) ---
PRODUCT_HTML = """
<html><head><title>Produit</title>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Product",
 "name":"Casque Bluetooth ProMax","brand":{"@type":"Brand","name":"SoundCorp"},
 "sku":"SC-PM-2024","gtin13":"3701234567890","category":"Audio",
 "image":["https://ex.com/img.jpg"],
 "offers":{"@type":"Offer","price":"89.99","priceCurrency":"EUR",
  "availability":"https://schema.org/InStock",
  "seller":{"@type":"Organization","name":"BoutiqueSon"}}}
</script></head>
<body><h1>Casque Bluetooth ProMax</h1>
<span class="price">89,99 €</span> <del>149,00 €</del>
<p>Livraison gratuite. En stock.</p></body></html>
"""

LISTING_HTML = """
<html><body>
<div class="product"><a href="/produit/casque-1">Casque</a></div>
<div class="product"><a href="/produit/enceinte-2">Enceinte</a></div>
<a href="/aide">Aide</a>
<a href="https://autre.com/produit/x">Externe</a>
</body></html>
"""


# ------------------------------------------------------------------- extraction
def test_parse_price_formats():
    assert parse_price("1 299,99 €") == 1299.99
    assert parse_price("1.299,99") == 1299.99
    assert parse_price("89.99") == 89.99
    assert parse_price("gratuit") is None


def test_extract_full_product():
    p = extract_product(PRODUCT_HTML)
    assert p.name == "Casque Bluetooth ProMax"
    assert p.price == 89.99
    assert p.old_price == 149.0
    assert p.discount_percent == 39.6      # (149-89.99)/149
    assert p.availability == "in_stock"
    assert p.ean == "3701234567890"
    assert p.brand == "SoundCorp"
    assert p.mpn == "SC-PM-2024"
    assert p.category == "Audio"
    assert p.seller == "BoutiqueSon"


def test_extract_product_links_filters_domain():
    links = extract_product_links(LISTING_HTML, "https://shop.fr/recherche?q=x")
    assert "https://shop.fr/produit/casque-1" in links
    assert "https://shop.fr/produit/enceinte-2" in links
    assert not any("autre.com" in l for l in links)   # domaine externe exclu
    assert not any("/aide" in l for l in links)        # non-produit exclu


# -------------------------------------------------------------------- registry
def test_registry_populated():
    names = {c.name for c in connectors.all_connectors()}
    for expected in ("amazon", "cdiscount", "fnac", "darty", "boulanger",
                     "ldlc", "ebay", "aliexpress"):
        assert expected in names


def test_for_url_routing():
    assert connectors.for_url("https://www.amazon.fr/dp/B0XXXX").name == "amazon"
    assert connectors.for_url("https://www.ldlc.com/fiche/ABC.html").name == "ldlc"
    # Domaine inconnu -> connecteur générique
    assert connectors.for_url("https://boutique-inconnue.fr/p/1").name == "generic"


def test_search_url_building():
    ldlc = connectors.by_name("ldlc")
    links, status = [], None
    # On ne fait pas de requête réseau : on vérifie juste le gabarit d'URL
    url = ldlc.search_url_template.format(query="rtx%204070")
    assert "rtx%204070" in url and url.startswith("https://www.ldlc.com")


def test_generic_has_no_search():
    assert connectors.by_name("generic").search_url_template == ""


def test_every_connector_declares_domain_and_label():
    for c in connectors.all_connectors():
        assert c.label
        if c.name != "generic":
            assert c.domains, f"{c.name} sans domaine"
            assert c.search_url_template, f"{c.name} sans URL de recherche"
