"""eBay Browse API — offres neuf/occasion. OAuth client_credentials.
Docs : https://developer.ebay.com/api-docs/buy/browse/overview.html
Clés : EBAY_CLIENT_ID, EBAY_CLIENT_SECRET (application keyset).
"""
import base64
import time

import requests

from ..config import settings
from .base import APIConnector, APIOffer
from .registry import register


@register
class EbayBrowse(APIConnector):
    name = "ebay_api"
    label = "eBay (Browse API)"
    kind = "price"
    docs = "https://developer.ebay.com/api-docs/buy/browse/overview.html"
    required_env = ("EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET")
    min_interval = 0.5
    cache_ttl = 1800

    def __init__(self):
        super().__init__()
        self._token = ""
        self._token_expiry = 0.0

    def _get_token(self) -> str | None:
        if self._token and time.time() < self._token_expiry - 60:
            return self._token
        creds = f"{settings.EBAY_CLIENT_ID}:{settings.EBAY_CLIENT_SECRET}"
        auth = base64.b64encode(creds.encode()).decode()
        try:
            resp = requests.post(
                "https://api.ebay.com/identity/v1/oauth2/token",
                headers={"Authorization": f"Basic {auth}",
                         "Content-Type": "application/x-www-form-urlencoded"},
                data={"grant_type": "client_credentials",
                      "scope": "https://api.ebay.com/oauth/api_scope"},
                timeout=20)
            resp.raise_for_status()
            payload = resp.json()
        except Exception as exc:
            self.log.warning("OAuth eBay échoué : %s", exc)
            return None
        self._token = payload.get("access_token", "")
        self._token_expiry = time.time() + payload.get("expires_in", 7200)
        return self._token

    def search(self, query: str, limit: int = 10) -> list[APIOffer]:
        if not self.configured:
            return []
        token = self._get_token()
        if not token:
            return []
        data = self._get(
            "https://api.ebay.com/buy/browse/v1/item_summary/search",
            params={"q": query, "limit": min(limit, 50)},
            headers={"Authorization": f"Bearer {token}",
                     "X-EBAY-C-MARKETPLACE-ID": settings.EBAY_MARKETPLACE},
            cache_key=f"ebay:{settings.EBAY_MARKETPLACE}:{query}:{limit}")
        offers: list[APIOffer] = []
        for it in (data or {}).get("itemSummaries", [])[:limit]:
            price = it.get("price", {}) or {}
            image = (it.get("image", {}) or {}).get("imageUrl", "")
            seller = (it.get("seller", {}) or {}).get("username", "")
            try:
                value = float(price.get("value")) if price.get("value") else None
            except (TypeError, ValueError):
                value = None
            offers.append(APIOffer(
                source=self.name, title=it.get("title", ""), price=value,
                currency=price.get("currency", "EUR"),
                availability="in_stock", seller=seller, image=image,
                url=it.get("itemWebUrl", ""),
                condition=it.get("condition", ""),
                ean=(it.get("epid", "") or "")))
        return offers
