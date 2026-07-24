"""E.Leclerc — grande distribution, rendu JS."""
from .base import BaseConnector
from .registry import register


@register
class LeclercConnector(BaseConnector):
    name = "leclerc"
    label = "E.Leclerc"
    domains = ("e.leclerc", "leclercdrive.fr")
    search_url_template = "https://www.e.leclerc/recherche?q={query}"
    product_url_patterns = ("/fp/", "/p/")
    needs_playwright = True
    min_delay = 3.0
    trusted = True
