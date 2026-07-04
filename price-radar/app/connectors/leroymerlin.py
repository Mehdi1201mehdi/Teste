"""Leroy Merlin — bricolage, fiches produit schema.org."""
from .base import BaseConnector
from .registry import register


@register
class LeroyMerlinConnector(BaseConnector):
    name = "leroymerlin"
    label = "Leroy Merlin"
    domains = ("leroymerlin.fr",)
    search_url_template = "https://www.leroymerlin.fr/produits/recherche.html?query={query}"
    product_url_patterns = ("/produits/", "/p/")
    needs_playwright = True
    min_delay = 3.0
    trusted = True
