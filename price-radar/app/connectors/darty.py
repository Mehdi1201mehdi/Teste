"""Darty — fiches produit riches en schema.org."""
from .base import BaseConnector
from .registry import register


@register
class DartyConnector(BaseConnector):
    name = "darty"
    label = "Darty"
    domains = ("darty.com",)
    search_url_template = "https://www.darty.com/nav/recherche?text={query}"
    product_url_patterns = ("/nav/achat/", "/dar_")
    needs_playwright = True
    min_delay = 3.0
    trusted = True
