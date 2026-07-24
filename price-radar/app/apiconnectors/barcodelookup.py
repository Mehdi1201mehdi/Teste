"""Barcode Lookup API — métadonnées produit + magasins/prix.
Clé requise. Docs : https://www.barcodelookup.com/api
"""
from ..config import settings
from .base import APIConnector, APIOffer, APIProduct
from .registry import register


@register
class BarcodeLookup(APIConnector):
    name = "barcodelookup"
    label = "Barcode Lookup"
    kind = "catalog"
    docs = "https://www.barcodelookup.com/api"
    required_env = ("BARCODE_LOOKUP_KEY",)
    min_interval = 1.5
    cache_ttl = 43200

    def _products(self, params: dict) -> list[dict]:
        params = {**params, "key": settings.BARCODE_LOOKUP_KEY}
        data = self._get("https://api.barcodelookup.com/v3/products",
                         params=params,
                         cache_key=f"barcodelookup:{sorted(params.items())}")
        return (data or {}).get("products", [])

    def _offers(self, p: dict) -> list[APIOffer]:
        offers = []
        for s in p.get("stores", []):
            price = s.get("price")
            try:
                price = float(price) if price not in (None, "") else None
            except (TypeError, ValueError):
                price = None
            offers.append(APIOffer(
                source=self.name, title=p.get("title", ""), price=price,
                currency=s.get("currency", "EUR") or "EUR",
                seller=s.get("store_name", ""), url=s.get("link", ""),
                availability=s.get("availability", "") or "unknown",
                image=(p.get("images") or [""])[0],
                brand=p.get("brand", ""), ean=str(p.get("barcode_number", "")),
                category=p.get("category", "")))
        return offers

    def lookup(self, barcode: str) -> APIProduct | None:
        if not self.configured:
            return None
        products = self._products({"barcode": barcode})
        if not products:
            return None
        p = products[0]
        return APIProduct(
            source=self.name, ean=str(p.get("barcode_number", barcode)),
            name=p.get("title", ""), brand=p.get("brand", ""),
            category=p.get("category", ""),
            image=(p.get("images") or [""])[0],
            description=p.get("description", ""),
            extra={"offers": [o.dict() for o in self._offers(p)]})

    def search(self, query: str, limit: int = 10) -> list[APIOffer]:
        if not self.configured:
            return []
        offers: list[APIOffer] = []
        for p in self._products({"search": query})[:limit]:
            offers.extend(self._offers(p))
        return offers[:limit]
