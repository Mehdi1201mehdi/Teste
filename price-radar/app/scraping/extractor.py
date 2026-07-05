"""Extraction des données produit depuis le HTML d'une page e-commerce.

Stratégies, de la plus fiable à la moins fiable :
1. JSON-LD schema.org/Product (la grande majorité des sites e-commerce)
2. Balises OpenGraph / meta produit (og:price:amount, itemprop=price…)
3. Sélecteurs CSS génériques + regex de prix en dernier recours
"""
import json
import re
from dataclasses import dataclass, field

from bs4 import BeautifulSoup

PRICE_RE = re.compile(
    r"(\d{1,3}(?:[  .]\d{3})*(?:[.,]\d{1,2})?)\s*(?:€|EUR)", re.IGNORECASE
)

AVAILABILITY_MAP = {
    "instock": "in_stock",
    "in_stock": "in_stock",
    "limitedavailability": "in_stock",
    "onlineonly": "in_stock",
    "preorder": "preorder",
    "outofstock": "out_of_stock",
    "out_of_stock": "out_of_stock",
    "soldout": "out_of_stock",
    "discontinued": "out_of_stock",
}


@dataclass
class ExtractedProduct:
    name: str = ""
    price: float | None = None
    old_price: float | None = None
    currency: str = "EUR"
    image_url: str = ""
    availability: str = "unknown"
    shipping_cost: float | None = None
    seller: str = ""
    ean: str = ""
    brand: str = ""
    mpn: str = ""              # référence constructeur / manufacturer part number
    category: str = ""
    sources: list[str] = field(default_factory=list)

    @property
    def usable(self) -> bool:
        return self.price is not None

    @property
    def discount_percent(self) -> float | None:
        """Pourcentage de réduction si un ancien prix est disponible."""
        if self.old_price and self.price and self.old_price > self.price:
            return round((self.old_price - self.price) / self.old_price * 100, 1)
        return None


def parse_price(value) -> float | None:
    """Convertit '1 299,99 €', '1299.99' ou 1299.99 en float."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value) if value > 0 else None
    text = str(value).strip()
    m = PRICE_RE.search(text)
    if m:
        text = m.group(1)
    text = text.replace(" ", "").replace(" ", "")
    # '1.299,99' → '1299.99' ; '1299,99' → '1299.99'
    if "," in text and "." in text:
        text = text.replace(".", "").replace(",", ".")
    elif "," in text:
        text = text.replace(",", ".")
    try:
        price = float(re.sub(r"[^\d.]", "", text))
        return price if price > 0 else None
    except ValueError:
        return None


def _map_availability(value: str) -> str:
    if not value:
        return "unknown"
    key = value.lower().split("/")[-1].replace("-", "_")
    return AVAILABILITY_MAP.get(key, "unknown")


def _first(*values) -> str:
    """Première valeur non vide, en chaîne (sinon '')."""
    for v in values:
        if v:
            return str(v)
    return ""


def _ld_image(value) -> str:
    """URL d'image depuis un champ JSON-LD 'image' (str, liste ou objet)."""
    if isinstance(value, list) and value:
        value = value[0]
    if isinstance(value, dict):
        value = value.get("url", "")
    return str(value or "")


def _ld_scalar(value) -> str:
    """Valeur scalaire depuis un champ JSON-LD (brand/category : str/liste/objet)."""
    if isinstance(value, list) and value:
        value = value[0]
    if isinstance(value, dict):
        value = value.get("name") or value.get("value") or ""
    return str(value or "")


def _is_ld_product(item: dict) -> bool:
    item_type = item.get("@type", "")
    types = item_type if isinstance(item_type, list) else [item_type]
    return "Product" in types


def _ld_documents(soup: BeautifulSoup):
    """Objets JSON-LD décodés depuis chaque <script> (au niveau document)."""
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.string or "")
        except (json.JSONDecodeError, TypeError):
            continue
        yield from (data if isinstance(data, list) else [data])


def _ld_nodes(item):
    """Nœuds d'un document JSON-LD (déplie @graph si présent)."""
    graph = item.get("@graph") if isinstance(item, dict) else None
    return graph if isinstance(graph, list) else [item]


def _iter_ld_products(soup: BeautifulSoup):
    """Itère les objets schema.org/Product des scripts JSON-LD (@graph inclus)."""
    for item in _ld_documents(soup):
        for node in _ld_nodes(item):
            if isinstance(node, dict) and _is_ld_product(node):
                yield node


def _ld_seller(offers: dict) -> str:
    seller = offers.get("seller", {})
    return str(seller.get("name", "")) if isinstance(seller, dict) else ""


def _apply_ld_offer(offers, result: ExtractedProduct):
    """Renseigne prix/devise/dispo/vendeur depuis un bloc offers JSON-LD."""
    if isinstance(offers, list) and offers:
        offers = offers[0]
    if not isinstance(offers, dict):
        return
    result.price = result.price or parse_price(
        offers.get("price") or offers.get("lowPrice"))  # AggregateOffer → lowPrice
    result.currency = str(offers.get("priceCurrency") or "EUR")
    result.availability = _map_availability(str(offers.get("availability", "")))
    result.seller = result.seller or _ld_seller(offers)


def _apply_ld_product(item: dict, result: ExtractedProduct):
    """Renseigne les champs produit depuis un objet schema.org/Product."""
    result.name = result.name or str(item.get("name", "")).strip()
    result.image_url = result.image_url or _ld_image(item.get("image", ""))
    result.ean = result.ean or _first(
        item.get("gtin13"), item.get("gtin14"), item.get("gtin12"),
        item.get("gtin"), item.get("gtin8"))
    result.mpn = result.mpn or _first(item.get("mpn"), item.get("sku"))
    result.brand = result.brand or _ld_scalar(item.get("brand", ""))
    result.category = result.category or _ld_scalar(item.get("category", ""))
    _apply_ld_offer(item.get("offers", {}), result)


def _extract_json_ld(soup: BeautifulSoup, result: ExtractedProduct) -> bool:
    """Cherche un objet schema.org/Product dans les scripts JSON-LD."""
    for item in _iter_ld_products(soup):
        _apply_ld_product(item, result)
        if result.price:
            result.sources.append("json-ld")
            return True
    return False


def _meta_content(soup: BeautifulSoup, *names: str) -> str:
    """Contenu du 1er <meta> trouvé par property / name / itemprop."""
    for name in names:
        tag = soup.find("meta", attrs={"property": name}) or \
              soup.find("meta", attrs={"name": name}) or \
              soup.find("meta", attrs={"itemprop": name})
        if tag and tag.get("content"):
            return tag["content"].strip()
    return ""


def _meta_price_text(soup: BeautifulSoup) -> str:
    """Prix brut depuis les meta produit, sinon microdata itemprop=price."""
    price = _meta_content(soup, "product:price:amount", "og:price:amount", "price")
    if price:
        return price
    tag = soup.find(attrs={"itemprop": "price"})
    if tag:
        return tag.get("content") or tag.get_text()
    return ""


def _extract_meta(soup: BeautifulSoup, result: ExtractedProduct) -> bool:
    """OpenGraph / meta produit / microdata itemprop."""
    result.name = result.name or _meta_content(soup, "og:title", "twitter:title")
    result.image_url = result.image_url or _meta_content(soup, "og:image", "twitter:image")
    result.brand = result.brand or _meta_content(soup, "product:brand", "og:brand", "brand")
    result.ean = result.ean or _meta_content(soup, "product:ean", "product:gtin13")
    currency = _meta_content(soup, "product:price:currency", "og:price:currency")
    if currency:
        result.currency = currency
    if result.price:
        return False
    result.price = parse_price(_meta_price_text(soup))
    if result.price:
        result.sources.append("meta")
        return True
    return False


PRICE_SELECTORS = (
    '[class*="price--current"]', '[class*="current-price"]',
    '[class*="product-price"]', '[class*="sales-price"]',
    '[data-price]', ".price", '[class*="price"]',
)
OLD_PRICE_SELECTOR = ('del, s, [class*="old-price"], '
                      '[class*="price--old"], [class*="strike"]')


def _css_name(soup: BeautifulSoup, result: ExtractedProduct):
    if result.name:
        return
    h1 = soup.find("h1")
    if h1:
        result.name = h1.get_text(strip=True)
    elif soup.title:
        result.name = soup.title.get_text(strip=True)


def _css_price(soup: BeautifulSoup, result: ExtractedProduct):
    if result.price:
        return
    for selector in PRICE_SELECTORS:
        for tag in soup.select(selector):
            price = parse_price(tag.get("data-price") or tag.get_text())
            if price:
                result.price = price
                result.sources.append(f"css:{selector}")
                return


def _css_old_price(soup: BeautifulSoup, result: ExtractedProduct):
    if result.old_price is not None:
        return
    for tag in soup.select(OLD_PRICE_SELECTOR):
        old = parse_price(tag.get_text())
        if old and (result.price is None or old > result.price):
            result.old_price = old
            return


def _css_regex_price(soup: BeautifulSoup, result: ExtractedProduct):
    """Dernier recours : première occurrence '1 234,56 €' dans le body."""
    if result.price:
        return
    m = PRICE_RE.search(soup.get_text(" ", strip=True)[:20000])
    if m:
        result.price = parse_price(m.group(0))
        if result.price:
            result.sources.append("regex")


def _extract_css_fallback(soup: BeautifulSoup, result: ExtractedProduct) -> bool:
    """Sélecteurs génériques rencontrés sur la plupart des boutiques."""
    _css_name(soup, result)
    _css_price(soup, result)
    _css_old_price(soup, result)
    _css_regex_price(soup, result)
    return result.price is not None


def _extract_shipping(soup: BeautifulSoup, result: ExtractedProduct):
    text = soup.get_text(" ", strip=True).lower()[:30000]
    if re.search(r"livraison\s+(gratuite|offerte)|free\s+(shipping|delivery)", text):
        result.shipping_cost = 0.0
        return
    m = re.search(r"livraison\s*(?:à partir de|dès|:)?\s*(\d+[.,]?\d*)\s*€", text)
    if m:
        result.shipping_cost = parse_price(m.group(1))


IN_STOCK_RE = re.compile(r"en stock|disponible|in stock|add to cart|ajouter au panier")
OUT_STOCK_RE = re.compile(r"rupture|épuisé|out of stock|indisponible|sold out")


def _run_extraction_cascade(soup: BeautifulSoup, result: ExtractedProduct):
    """JSON-LD → meta → CSS. Complète nom/ancien prix même si le prix vient
    du JSON-LD."""
    _extract_json_ld(soup, result)
    if not result.price:
        _extract_meta(soup, result)
    if not result.price:
        _extract_css_fallback(soup, result)
        return
    if not result.name:
        _extract_css_fallback(soup, result)
    _css_old_price(soup, result)


def _extract_availability_text(soup: BeautifulSoup, result: ExtractedProduct):
    """Disponibilité déduite du texte si toujours inconnue."""
    if result.availability != "unknown":
        return
    text = soup.get_text(" ", strip=True).lower()[:30000]
    if IN_STOCK_RE.search(text):
        result.availability = "in_stock"
    elif OUT_STOCK_RE.search(text):
        result.availability = "out_of_stock"


def extract_product(html: str) -> ExtractedProduct:
    soup = BeautifulSoup(html, "lxml")
    result = ExtractedProduct()
    _run_extraction_cascade(soup, result)
    _extract_shipping(soup, result)
    _extract_availability_text(soup, result)
    result.name = (result.name or "").strip()[:300]
    return result
