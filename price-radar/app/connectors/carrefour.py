"""Carrefour — grande distribution, rendu JS."""
from .base import BaseConnector
from .registry import register


@register
class CarrefourConnector(BaseConnector):
    name = "carrefour"
    label = "Carrefour"
    domains = ("carrefour.fr",)
    search_url_template = "https://www.carrefour.fr/s?q={query}"
    product_url_patterns = ("/p/",)
    needs_playwright = True
    min_delay = 3.0
    trusted = True
