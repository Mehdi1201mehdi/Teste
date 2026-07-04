"""Rakuten France — marketplace (vendeurs tiers)."""
from .base import BaseConnector
from .registry import register


@register
class RakutenConnector(BaseConnector):
    name = "rakuten"
    label = "Rakuten"
    domains = ("rakuten.com", "fr.shopping.rakuten.com")
    search_url_template = "https://fr.shopping.rakuten.com/search/{query}"
    product_url_patterns = ("/mfp/", "/offer/", "/produit/")
    needs_playwright = True
    min_delay = 3.0
    trusted = False
