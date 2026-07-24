"""Boulanger — pages produit schema.org, référence via /ref/."""
from .base import BaseConnector
from .registry import register


@register
class BoulangerConnector(BaseConnector):
    name = "boulanger"
    label = "Boulanger"
    domains = ("boulanger.com",)
    search_url_template = "https://www.boulanger.com/resultats?tr={query}"
    product_url_patterns = ("/ref/",)
    needs_playwright = True
    min_delay = 3.0
    trusted = True
