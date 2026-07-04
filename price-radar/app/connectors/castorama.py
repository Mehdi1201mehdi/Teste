"""Castorama — bricolage."""
from .base import BaseConnector
from .registry import register


@register
class CastoramaConnector(BaseConnector):
    name = "castorama"
    label = "Castorama"
    domains = ("castorama.fr",)
    search_url_template = "https://www.castorama.fr/search?q={query}"
    product_url_patterns = ("/p/", "/prod/")
    needs_playwright = True
    min_delay = 3.0
    trusted = True
