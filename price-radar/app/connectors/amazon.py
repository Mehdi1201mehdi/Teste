"""Amazon — marketplace, anti-bot très agressif (nécessite Playwright +
proxies résidentiels). Vendeurs tiers : fiabilité variable."""
from .base import BaseConnector
from .registry import register


@register
class AmazonConnector(BaseConnector):
    name = "amazon"
    label = "Amazon"
    domains = ("amazon.fr", "amazon.com", "amazon.co.uk", "amazon.de")
    search_url_template = "https://www.amazon.fr/s?k={query}"
    product_url_patterns = ("/dp/", "/gp/product/")
    needs_playwright = True
    min_delay = 4.0
    trusted = False
