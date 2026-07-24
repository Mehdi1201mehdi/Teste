"""Materiel.net — high-tech/informatique."""
from .base import BaseConnector
from .registry import register


@register
class MaterielNetConnector(BaseConnector):
    name = "materielnet"
    label = "Materiel.net"
    domains = ("materiel.net",)
    search_url_template = "https://www.materiel.net/recherche/{query}/"
    product_url_patterns = ("/produit/",)
    needs_playwright = False
    min_delay = 2.0
    trusted = True
