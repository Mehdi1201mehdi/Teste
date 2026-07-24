"""Auchan — grande distribution, rendu JS."""
from .base import BaseConnector
from .registry import register


@register
class AuchanConnector(BaseConnector):
    name = "auchan"
    label = "Auchan"
    domains = ("auchan.fr",)
    search_url_template = "https://www.auchan.fr/recherche?text={query}"
    product_url_patterns = ("/p-", "/pr-")
    needs_playwright = True
    min_delay = 3.0
    trusted = True
