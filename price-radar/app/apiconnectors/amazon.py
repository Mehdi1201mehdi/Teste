"""Amazon Product Advertising API v5 — recherche d'articles.
Signature AWS4-HMAC-SHA256. Docs :
https://webservices.amazon.com/paapi5/documentation/
Clés : AMAZON_ACCESS_KEY, AMAZON_SECRET_KEY, AMAZON_PARTNER_TAG.
Nécessite un compte Amazon Associates actif (avec ventes qualifiantes).
"""
import datetime
import hashlib
import hmac
import json

import requests

from ..config import settings
from .base import APIConnector, APIOffer
from .registry import register

SERVICE = "ProductAdvertisingAPI"
TARGET = "com.amazon.paapi5.v1.ProductAdvertisingAPIv1.SearchItems"


def _sign(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


@register
class AmazonPAAPI(APIConnector):
    name = "amazon_api"
    label = "Amazon (PA-API v5)"
    kind = "price"
    docs = "https://webservices.amazon.com/paapi5/documentation/"
    required_env = ("AMAZON_ACCESS_KEY", "AMAZON_SECRET_KEY", "AMAZON_PARTNER_TAG")
    min_interval = 1.1        # PA-API : ~1 req/s au départ
    cache_ttl = 1800

    def _signed_headers(self, payload: str) -> dict:
        host = settings.AMAZON_HOST
        region = settings.AMAZON_REGION
        now = datetime.datetime.now(datetime.timezone.utc)
        amz_date = now.strftime("%Y%m%dT%H%M%SZ")
        date_stamp = now.strftime("%Y%m%d")

        canonical_uri = "/paapi5/searchitems"
        canonical_headers = (
            f"content-encoding:amz-1.0\n"
            f"host:{host}\n"
            f"x-amz-date:{amz_date}\n"
            f"x-amz-target:{TARGET}\n")
        signed_headers = "content-encoding;host;x-amz-date;x-amz-target"
        payload_hash = hashlib.sha256(payload.encode()).hexdigest()
        canonical_request = (
            f"POST\n{canonical_uri}\n\n{canonical_headers}\n"
            f"{signed_headers}\n{payload_hash}")

        algorithm = "AWS4-HMAC-SHA256"
        scope = f"{date_stamp}/{region}/{SERVICE}/aws4_request"
        string_to_sign = (
            f"{algorithm}\n{amz_date}\n{scope}\n"
            f"{hashlib.sha256(canonical_request.encode()).hexdigest()}")

        k_date = _sign(f"AWS4{settings.AMAZON_SECRET_KEY}".encode(), date_stamp)
        k_region = _sign(k_date, region)
        k_service = _sign(k_region, SERVICE)
        k_signing = _sign(k_service, "aws4_request")
        signature = hmac.new(k_signing, string_to_sign.encode(),
                             hashlib.sha256).hexdigest()

        authorization = (
            f"{algorithm} Credential={settings.AMAZON_ACCESS_KEY}/{scope}, "
            f"SignedHeaders={signed_headers}, Signature={signature}")
        return {
            "content-encoding": "amz-1.0",
            "content-type": "application/json; charset=utf-8",
            "host": host, "x-amz-date": amz_date, "x-amz-target": TARGET,
            "Authorization": authorization,
        }

    def search(self, query: str, limit: int = 10) -> list[APIOffer]:
        if not self.configured:
            return []
        body = {
            "Keywords": query, "SearchIndex": "All",
            "ItemCount": min(limit, 10),
            "PartnerTag": settings.AMAZON_PARTNER_TAG,
            "PartnerType": "Associates",
            "Marketplace": settings.AMAZON_MARKETPLACE,
            "Resources": ["Images.Primary.Medium", "ItemInfo.Title",
                          "ItemInfo.ByLineInfo", "Offers.Listings.Price",
                          "Offers.Listings.Availability.Message"],
        }
        payload = json.dumps(body)
        url = f"https://{settings.AMAZON_HOST}/paapi5/searchitems"
        cache_key = f"amazon:{settings.AMAZON_MARKETPLACE}:{query}:{limit}"
        data = self._request("POST", url, data=payload,
                             headers=self._signed_headers(payload),
                             cache_key=cache_key)
        offers: list[APIOffer] = []
        items = (((data or {}).get("SearchResult") or {}).get("Items")) or []
        for it in items[:limit]:
            info = it.get("ItemInfo", {}) or {}
            title = (info.get("Title", {}) or {}).get("DisplayValue", "")
            brand = ((info.get("ByLineInfo", {}) or {})
                     .get("Brand", {}) or {}).get("DisplayValue", "")
            image = ((it.get("Images", {}) or {}).get("Primary", {}) or {}
                     ).get("Medium", {}).get("URL", "")
            listing = ((it.get("Offers", {}) or {}).get("Listings") or [{}])[0]
            price_info = listing.get("Price", {}) or {}
            offers.append(APIOffer(
                source=self.name, title=title,
                price=price_info.get("Amount"),
                currency=price_info.get("Currency", "EUR"),
                availability="in_stock", seller="Amazon", image=image,
                url=it.get("DetailPageURL", ""), brand=brand))
        return offers
