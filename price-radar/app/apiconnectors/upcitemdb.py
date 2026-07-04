"""UPCitemDB — base de codes-barres avec offres marchandes.
Palier « trial » sans clé (quota ~100/jour) ; clé pour le plan payant.
Docs : https://www.upcitemdb.com/api
"""
from ..config import settings
from .base import APIConnector, APIOffer, APIProduct
from .registry import register


@register
class UPCitemDB(APIConnector):
    name = "upcitemdb"
    label = "UPCitemDB"
    kind = "catalog"          # métadonnées + offres éventuelles
    docs = "https://www.upcitemdb.com/api"
    min_interval = 2.0
    cache_ttl = 43200

    def _endpoint(self, path: str) -> tuple[str, dict]:
        if settings.UPCITEMDB_KEY:
            return (f"https://api.upcitemdb.com/prod/v1/{path}",
                    {"user_key": settings.UPCITEMDB_KEY, "key_type": "3scale"})
        return f"https://api.upcitemdb.com/prod/trial/{path}", {}

    def _offers_from_item(self, item: dict) -> list[APIOffer]:
        offers = []
        for o in item.get("offers", []):
            offers.append(APIOffer(
                source=self.name, title=item.get("title", ""),
                price=o.get("price"), currency=o.get("currency", "USD"),
                availability=o.get("availability", "") or "unknown",
                seller=o.get("merchant", ""), url=o.get("link", ""),
                image=(item.get("images") or [""])[0],
                condition=o.get("condition", ""),
                brand=item.get("brand", ""), ean=str(item.get("ean", "")),
                category=item.get("category", "")))
        return offers

    def lookup(self, barcode: str) -> APIProduct | None:
        url, headers = self._endpoint("lookup")
        data = self._get(url, params={"upc": barcode}, headers=headers,
                         cache_key=f"upcitemdb:l:{barcode}")
        items = (data or {}).get("items", [])
        if not items:
            return None
        it = items[0]
        return APIProduct(
            source=self.name, ean=str(it.get("ean", barcode)),
            name=it.get("title", ""), brand=it.get("brand", ""),
            category=it.get("category", ""),
            image=(it.get("images") or [""])[0],
            description=it.get("description", ""),
            extra={"offers": [o.dict() for o in self._offers_from_item(it)]})

    def search(self, query: str, limit: int = 10) -> list[APIOffer]:
        url, headers = self._endpoint("search")
        data = self._get(url, params={"s": query, "type": "product"},
                         headers=headers, cache_key=f"upcitemdb:s:{query}")
        offers: list[APIOffer] = []
        for it in (data or {}).get("items", [])[:limit]:
            offers.extend(self._offers_from_item(it))
        return offers[:limit]
