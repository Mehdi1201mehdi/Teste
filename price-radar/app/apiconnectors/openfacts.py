"""Connecteurs Open*Facts (Open Food/Beauty/Pet Food/Products Facts).

Bases de données produits ouvertes, sans clé. Elles fournissent des
métadonnées (nom, marque, catégorie, image, EAN, description) — PAS de prix.
Elles servent à enrichir un produit à partir de son code-barres.
Docs : https://world.openfoodfacts.org/api
"""
from .base import APIConnector, APIProduct
from .registry import register


class _OpenFactsBase(APIConnector):
    kind = "catalog"
    domain = ""             # ex : world.openfoodfacts.org
    min_interval = 1.0
    cache_ttl = 86400

    def lookup(self, barcode: str) -> APIProduct | None:
        url = f"https://{self.domain}/api/v2/product/{barcode}.json"
        data = self._get(url, cache_key=f"{self.name}:p:{barcode}")
        if not data or data.get("status") != 1:
            return None
        p = data.get("product", {})
        return APIProduct(
            source=self.name, ean=str(data.get("code", barcode)),
            name=p.get("product_name") or p.get("generic_name", ""),
            brand=p.get("brands", ""),
            category=(p.get("categories", "").split(",")[0].strip()
                      if p.get("categories") else ""),
            image=p.get("image_url") or p.get("image_front_url", ""),
            description=p.get("generic_name", ""),
            extra={"quantity": p.get("quantity", ""),
                   "labels": p.get("labels", "")},
        )

    def search(self, query: str, limit: int = 10):
        """Open*Facts n'est pas une source de prix : la recherche renvoie des
        métadonnées, pas des offres. On la laisse vide côté comparaison prix."""
        return []

    def search_products(self, query: str, limit: int = 10) -> list[APIProduct]:
        url = f"https://{self.domain}/cgi/search.pl"
        data = self._get(url, params={"search_terms": query, "json": 1,
                                      "page_size": limit},
                         cache_key=f"{self.name}:s:{query}:{limit}")
        out: list[APIProduct] = []
        for p in (data or {}).get("products", [])[:limit]:
            out.append(APIProduct(
                source=self.name, ean=str(p.get("code", "")),
                name=p.get("product_name", ""), brand=p.get("brands", ""),
                category=(p.get("categories", "").split(",")[0].strip()
                          if p.get("categories") else ""),
                image=p.get("image_url", ""),
                description=p.get("generic_name", "")))
        return out


@register
class OpenFoodFacts(_OpenFactsBase):
    name = "openfoodfacts"
    label = "Open Food Facts"
    domain = "world.openfoodfacts.org"
    docs = "https://world.openfoodfacts.org/api"


@register
class OpenBeautyFacts(_OpenFactsBase):
    name = "openbeautyfacts"
    label = "Open Beauty Facts"
    domain = "world.openbeautyfacts.org"
    docs = "https://world.openbeautyfacts.org"


@register
class OpenPetFoodFacts(_OpenFactsBase):
    name = "openpetfoodfacts"
    label = "Open Pet Food Facts"
    domain = "world.openpetfoodfacts.org"
    docs = "https://world.openpetfoodfacts.org"


@register
class OpenProductsFacts(_OpenFactsBase):
    name = "openproductsfacts"
    label = "Open Products Facts"
    domain = "world.openproductsfacts.org"
    docs = "https://world.openproductsfacts.org"
