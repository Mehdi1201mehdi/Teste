"""AliExpress Open Platform — recherche de produits affiliés.
Signature HMAC-SHA256 des paramètres système + métier. Docs :
https://open.aliexpress.com/
Clés : ALIEXPRESS_APP_KEY, ALIEXPRESS_APP_SECRET (+ compte affilié).
"""
import hashlib
import hmac
import time

from ..config import settings
from .base import APIConnector, APIOffer
from .registry import register

GATEWAY = "https://api-sg.aliexpress.com/sync"
METHOD = "aliexpress.affiliate.product.query"


@register
class AliExpressOpen(APIConnector):
    name = "aliexpress_api"
    label = "AliExpress (Open Platform)"
    kind = "price"
    docs = "https://open.aliexpress.com/"
    required_env = ("ALIEXPRESS_APP_KEY", "ALIEXPRESS_APP_SECRET")
    min_interval = 1.0
    cache_ttl = 1800

    def _sign(self, params: dict) -> str:
        base = "".join(f"{k}{params[k]}" for k in sorted(params))
        return hmac.new(settings.ALIEXPRESS_APP_SECRET.encode(), base.encode(),
                        hashlib.sha256).hexdigest().upper()

    def search(self, query: str, limit: int = 10) -> list[APIOffer]:
        if not self.configured:
            return []
        params = {
            "app_key": settings.ALIEXPRESS_APP_KEY, "method": METHOD,
            "timestamp": str(int(time.time() * 1000)),
            "sign_method": "hmac-sha256", "format": "json", "v": "2.0",
            "keywords": query, "page_size": str(min(limit, 50)),
            "page_no": "1", "target_currency": "EUR", "target_language": "FR",
        }
        if settings.ALIEXPRESS_TRACKING_ID:
            params["tracking_id"] = settings.ALIEXPRESS_TRACKING_ID
        params["sign"] = self._sign(params)

        data = self._get(GATEWAY, params=params,
                         cache_key=f"aliexpress:{query}:{limit}")
        offers: list[APIOffer] = []
        try:
            resp = (data.get("aliexpress_affiliate_product_query_response", {})
                    .get("resp_result", {}).get("result", {}))
            products = resp.get("products", {}).get("product", [])
        except AttributeError:
            products = []
        for p in products[:limit]:
            price = p.get("target_sale_price") or p.get("sale_price")
            try:
                price = float(price) if price else None
            except (TypeError, ValueError):
                price = None
            offers.append(APIOffer(
                source=self.name, title=p.get("product_title", ""),
                price=price,
                currency=p.get("target_sale_price_currency", "EUR"),
                availability="in_stock",
                seller=p.get("shop_url", "") or "AliExpress",
                image=p.get("product_main_image_url", ""),
                url=p.get("product_detail_url", ""),
                category=str(p.get("first_level_category_name", ""))))
        return offers
