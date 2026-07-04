"""ManoMano — bricolage/jardin, marketplace."""
from .base import BaseConnector
from .registry import register


@register
class ManoManoConnector(BaseConnector):
    name = "manomano"
    label = "ManoMano"
    domains = ("manomano.fr",)
    search_url_template = "https://www.manomano.fr/recherche/{query}"
    product_url_patterns = ("/p/",)
    needs_playwright = True
    min_delay = 3.0
    trusted = False
