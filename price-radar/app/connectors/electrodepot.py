"""Electro Dépôt — électroménager/high-tech discount."""
from .base import BaseConnector
from .registry import register


@register
class ElectroDepotConnector(BaseConnector):
    name = "electrodepot"
    label = "Electro Dépôt"
    domains = ("electrodepot.fr",)
    search_url_template = "https://www.electrodepot.fr/catalogsearch/result/?q={query}"
    product_url_patterns = ("/p/", ".html")
    needs_playwright = False
    min_delay = 2.5
    trusted = True
