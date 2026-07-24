"""Rue du Commerce — marketplace généraliste."""
from .base import BaseConnector
from .registry import register


@register
class RueDuCommerceConnector(BaseConnector):
    name = "rueducommerce"
    label = "Rue du Commerce"
    domains = ("rueducommerce.fr",)
    search_url_template = "https://www.rueducommerce.fr/r/{query}.html"
    product_url_patterns = ("/p/", "/produit/")
    needs_playwright = True
    min_delay = 3.0
    trusted = False
