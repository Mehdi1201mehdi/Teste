"""Cdiscount — protection DataDome fréquente (Playwright conseillé)."""
from .base import BaseConnector
from .registry import register


@register
class CdiscountConnector(BaseConnector):
    name = "cdiscount"
    label = "Cdiscount"
    domains = ("cdiscount.com",)
    search_url_template = "https://www.cdiscount.com/search/10/{query}.html"
    product_url_patterns = ("/f-", "/dp/")
    needs_playwright = True
    min_delay = 3.0
    trusted = False
