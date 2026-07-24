"""AliExpress — marketplace international, rendu JS et anti-bot marqués."""
from .base import BaseConnector
from .registry import register


@register
class AliExpressConnector(BaseConnector):
    name = "aliexpress"
    label = "AliExpress"
    domains = ("aliexpress.com", "fr.aliexpress.com")
    search_url_template = "https://www.aliexpress.com/wholesale?SearchText={query}"
    product_url_patterns = ("/item/",)
    needs_playwright = True
    min_delay = 4.0
    trusted = False
