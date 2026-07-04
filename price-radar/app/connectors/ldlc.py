"""LDLC — high-tech/informatique. Fiches produit bien structurées (schema.org),
souvent scrapables sans JavaScript."""
from .base import BaseConnector
from .registry import register


@register
class LDLCConnector(BaseConnector):
    name = "ldlc"
    label = "LDLC"
    domains = ("ldlc.com",)
    search_url_template = "https://www.ldlc.com/recherche/{query}/"
    product_url_patterns = ("/fiche/",)
    needs_playwright = False
    min_delay = 2.0
    trusted = True
