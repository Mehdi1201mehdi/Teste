"""Extraction des liens de fiches produits depuis une page listing/recherche.
Partagé par tous les connecteurs et par la découverte par catégorie."""
import json
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

# Segments d'URL génériques d'une fiche produit (complétés par connecteur)
DEFAULT_PRODUCT_HINTS = ("/product", "/produit", "/dp/", "/gp/product", "/p/",
                         "/item", "/article", "/ref/", "/prod/", "/pd/", "-p-",
                         "/f-", "/mp/")


def extract_product_links(html: str, base_url: str,
                          patterns: tuple[str, ...] = (),
                          limit: int = 40) -> list[str]:
    soup = BeautifulSoup(html, "lxml")
    domain = urlparse(base_url).netloc.replace("www.", "")
    hints = tuple(patterns) or DEFAULT_PRODUCT_HINTS
    found: list[str] = []
    seen: set[str] = set()

    def add(url: str | None):
        if not url:
            return
        full = urljoin(base_url, url).split("#")[0]
        p = urlparse(full)
        if p.scheme not in ("http", "https"):
            return
        if domain and p.netloc.replace("www.", "") != domain:
            return
        if full not in seen:
            seen.add(full)
            found.append(full)

    # 1. JSON-LD ItemList
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.string or "")
        except (json.JSONDecodeError, TypeError):
            continue
        for item in (data if isinstance(data, list) else [data]):
            if isinstance(item, dict) and item.get("@type") == "ItemList":
                for el in item.get("itemListElement", []):
                    if isinstance(el, dict):
                        url = el.get("url")
                        target = el.get("item")
                        if not url and isinstance(target, dict):
                            url = target.get("url") or target.get("@id")
                        add(url)

    # 2. Ancres dont le chemin ressemble à une fiche produit
    for a in soup.find_all("a", href=True):
        path = urlparse(urljoin(base_url, a["href"])).path.lower()
        if any(h in path for h in hints):
            add(a["href"])

    # 3. Ancres dans des cartes produit
    if len(found) < limit:
        for a in soup.select('[class*="product"] a[href], [class*="produit"] a[href], '
                             '[class*="card"] a[href], [data-product] a[href], '
                             'article a[href]'):
            add(a["href"])
            if len(found) >= limit:
                break

    return found[:limit]
