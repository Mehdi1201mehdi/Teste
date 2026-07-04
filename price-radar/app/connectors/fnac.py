"""Fnac — pages produit en schema.org, recherche parfois rendue en JS."""
from .base import BaseConnector
from .registry import register


@register
class FnacConnector(BaseConnector):
    name = "fnac"
    label = "Fnac"
    domains = ("fnac.com",)
    search_url_template = "https://www.fnac.com/SearchResult/ResultList.aspx?Search={query}"
    product_url_patterns = ("/a", "/mp")
    needs_playwright = True
    min_delay = 3.0
    trusted = True
