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
    sources: list[str] = field(default_factory=list)

    @property
    def usable(self) -> bool:
        return self.price is not None


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


def _extract_json_ld(soup: BeautifulSoup, result: ExtractedProduct) -> bool:
    """Cherche un objet schema.org/Product dans les scripts JSON-LD."""
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.string or "")
        except (json.JSONDecodeError, TypeError):
            continue
        candidates = data if isinstance(data, list) else [data]
        # @graph imbriqué
        flat = []
        for item in candidates:
            if isinstance(item, dict) and "@graph" in item:
                flat.extend(item["@graph"])
            else:
                flat.append(item)
        for item in flat:
            if not isinstance(item, dict):
                continue
            item_type = item.get("@type", "")
            types = item_type if isinstance(item_type, list) else [item_type]
            if "Product" not in types:
                continue

            result.name = result.name or str(item.get("name", "")).strip()
            image = item.get("image", "")
            if isinstance(image, list) and image:
                image = image[0]
            if isinstance(image, dict):
                image = image.get("url", "")
            result.image_url = result.image_url or str(image)
            result.ean = result.ean or str(
                item.get("gtin13") or item.get("gtin") or item.get("sku") or ""
            )

            offers = item.get("offers", {})
            if isinstance(offers, list) and offers:
                offers = offers[0]
            if isinstance(offers, dict):
                # AggregateOffer → lowPrice
                price = offers.get("price") or offers.get("lowPrice")
                result.price = result.price or parse_price(price)
                result.currency = str(offers.get("priceCurrency") or "EUR")
                result.availability = _map_availability(str(offers.get("availability", "")))
                seller = offers.get("seller", {})
                if isinstance(seller, dict):
                    result.seller = result.seller or str(seller.get("name", ""))
            if result.price:
                result.sources.append("json-ld")
                return True
    return False


def _extract_meta(soup: BeautifulSoup, result: ExtractedProduct) -> bool:
    """OpenGraph / meta produit / microdata itemprop."""
    def meta(*names: str) -> str:
        for name in names:
            tag = soup.find("meta", attrs={"property": name}) or \
                  soup.find("meta", attrs={"name": name}) or \
                  soup.find("meta", attrs={"itemprop": name})
            if tag and tag.get("content"):
                return tag["content"].strip()
        return ""

    result.name = result.name or meta("og:title", "twitter:title")
    result.image_url = result.image_url or meta("og:image", "twitter:image")
    price = meta("product:price:amount", "og:price:amount", "price")
    currency = meta("product:price:currency", "og:price:currency")
    if currency:
        result.currency = currency
    if not price:
        tag = soup.find(attrs={"itemprop": "price"})
        if tag:
            price = tag.get("content") or tag.get_text()
    if price and not result.price:
        result.price = parse_price(price)
        if result.price:
            result.sources.append("meta")
            return True
    return False


def _extract_css_fallback(soup: BeautifulSoup, result: ExtractedProduct) -> bool:
    """Sélecteurs génériques rencontrés sur la plupart des boutiques."""
    if not result.name:
        h1 = soup.find("h1")
        if h1:
            result.name = h1.get_text(strip=True)
        elif soup.title:
            result.name = soup.title.get_text(strip=True)

    price_selectors = [
        '[class*="price--current"]', '[class*="current-price"]',
        '[class*="product-price"]', '[class*="sales-price"]',
        '[data-price]', ".price", '[class*="price"]',
    ]
    if not result.price:
        for selector in price_selectors:
            for tag in soup.select(selector):
                price = parse_price(tag.get("data-price") or tag.get_text())
                if price:
                    result.price = price
                    result.sources.append(f"css:{selector}")
                    break
            if result.price:
                break

    # Prix barré (ancien prix)
    if result.old_price is None:
        for tag in soup.select('del, s, [class*="old-price"], '
                               '[class*="price--old"], [class*="strike"]'):
            old = parse_price(tag.get_text())
            if old and (result.price is None or old > result.price):
                result.old_price = old
                break

    # Dernier recours : première occurrence "1 234,56 €" dans le body
    if not result.price:
        body_text = soup.get_text(" ", strip=True)[:20000]
        m = PRICE_RE.search(body_text)
        if m:
            result.price = parse_price(m.group(0))
            if result.price:
                result.sources.append("regex")
    return result.price is not None


def _extract_shipping(soup: BeautifulSoup, result: ExtractedProduct):
    text = soup.get_text(" ", strip=True).lower()[:30000]
    if re.search(r"livraison\s+(gratuite|offerte)|free\s+(shipping|delivery)", text):
        result.shipping_cost = 0.0
        return
    m = re.search(r"livraison\s*(?:à partir de|dès|:)?\s*(\d+[.,]?\d*)\s*€", text)
    if m:
        result.shipping_cost = parse_price(m.group(1))


def extract_product(html: str) -> ExtractedProduct:
    soup = BeautifulSoup(html, "lxml")
    result = ExtractedProduct()

    _extract_json_ld(soup, result)
    if not result.price:
        _extract_meta(soup, result)
    if not result.price:
        _extract_css_fallback(soup, result)
    else:
        # Compléter old_price / nom même si le prix vient du JSON-LD
        _extract_css_fallback(soup, result) if not result.name else None
        if result.old_price is None:
            for tag in soup.select('del, s, [class*="old-price"], [class*="strike"]'):
                old = parse_price(tag.get_text())
                if old and old > (result.price or 0):
                    result.old_price = old
                    break
    _extract_shipping(soup, result)

    # Disponibilité en texte si toujours inconnue
    if result.availability == "unknown":
        text = soup.get_text(" ", strip=True).lower()[:30000]
        if re.search(r"en stock|disponible|in stock|add to cart|ajouter au panier", text):
            result.availability = "in_stock"
        elif re.search(r"rupture|épuisé|out of stock|indisponible|sold out", text):
            result.availability = "out_of_stock"

    result.name = (result.name or "").strip()[:300]
    return result
