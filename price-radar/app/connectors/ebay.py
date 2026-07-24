"""eBay France — marketplace, occasion et neuf."""
from .base import BaseConnector
from .registry import register


@register
class EbayConnector(BaseConnector):
    name = "ebay"
    label = "eBay"
    domains = ("ebay.fr", "ebay.com")
    search_url_template = "https://www.ebay.fr/sch/i.html?_nkw={query}"
    product_url_patterns = ("/itm/",)
    needs_playwright = False
    min_delay = 2.5
    trusted = False
