"""Schémas Pydantic des requêtes de l'API."""
from pydantic import BaseModel


class ProductIn(BaseModel):
    url: str
    name: str = ""
    image_url: str = ""
    ean: str = ""
    seller: str = ""
    category_id: int | None = None
    website_id: int | None = None
    market_price: float | None = None
    market_price_auto: bool = True
    active: bool = True
    check_frequency_minutes: int | None = None
    scrape_now: bool = True


class ProductUpdate(BaseModel):
    name: str | None = None
    image_url: str | None = None
    ean: str | None = None
    seller: str | None = None
    category_id: int | None = None
    website_id: int | None = None
    market_price: float | None = None
    market_price_auto: bool | None = None
    active: bool | None = None
    check_frequency_minutes: int | None = None


class WebsiteIn(BaseModel):
    name: str
    domain: str
    trusted: bool = False
    active: bool = True
    min_delay: float = 2.0
    needs_playwright: bool = False
    search_url_template: str = ""


class SearchIn(BaseModel):
    query: str
    website_ids: list[int] | None = None
    max_per_site: int = 5
    add_to_monitoring: bool = False


class DiscoverIn(BaseModel):
    max_items: int = 20
    add_to_monitoring: bool = True


class CategoryIn(BaseModel):
    name: str
    watch_url: str = ""
    active: bool = True


class SettingsIn(BaseModel):
    alert_min_gap_percent: float | None = None
    alert_min_margin_eur: float | None = None
    alert_only_in_stock: bool | None = None


class ProxySourceIn(BaseModel):
    name: str
    url: str
    protocol: str = "http"
    format: str = "text"
    enabled: bool = True


class PreviewIn(BaseModel):
    url: str


class ManualPriceIn(BaseModel):
    price: float
    old_price: float | None = None
    shipping: float | None = None
    availability: str = "unknown"
