"""Découverte de produits, via les connecteurs de site :
1. Recherche multi-sites par mot-clé (connecteur.search)
2. Découverte depuis une page catégorie / listing

⚠️ Honnêteté : il n'existe pas de recherche « sur tout internet ». On cherche
sur les sites disposant d'un connecteur (ou d'une URL de recherche). La
réussite dépend du site : anti-bot, rendu JavaScript (Playwright), évolution
de structure. Les échecs sont journalisés (Logs scraping), jamais inventés.
"""
import logging
from dataclasses import dataclass
from urllib.parse import urlparse

from sqlalchemy.orm import Session

from .. import models
from ..config import settings
from ..connectors import for_domain, for_url
from ..connectors.linkextract import extract_product_links
from ..scraping.cascade import cascade
from .watcher import record_price

logger = logging.getLogger("price-radar.discovery")


@dataclass
class DiscoveredItem:
    url: str
    name: str
    price: float | None
    old_price: float | None
    discount_percent: float | None
    availability: str
    brand: str
    image_url: str
    site: str
    method: str
    monitored: bool = False
    product_id: int | None = None
    opportunity_level: str | None = None
    gap_percent: float | None = None
    margin_eur: float | None = None


def _scrape_and_maybe_monitor(db: Session, url: str, site: models.Website | None,
                              category_id: int | None, add_to_monitoring: bool
                              ) -> DiscoveredItem | None:
    """Scrape une fiche produit via son connecteur ; l'ajoute à la
    surveillance si demandé. Journalise les échecs."""
    connector = for_url(url)
    result = connector.fetch(url)
    if not result.ok or result.product is None:
        db.add(models.ScrapingJob(url=url, status=result.status,
                                  method=connector.name, error=result.error))
        db.commit()
        return None

    d = result.product
    item = DiscoveredItem(
        url=url, name=d.name, price=d.price, old_price=d.old_price,
        discount_percent=d.discount_percent, availability=d.availability,
        brand=d.brand, image_url=d.image_url,
        site=site.name if site else connector.label, method=connector.name,
    )

    if add_to_monitoring:
        existing = db.query(models.Product).filter(
            models.Product.url == url).first()
        product = existing
        if product is None:
            product = models.Product(
                url=url, name=d.name, image_url=d.image_url, ean=d.ean,
                seller=d.seller or (site.name if site else ""),
                category_id=category_id,
                website_id=site.id if site else None,
                check_frequency_minutes=settings.DEFAULT_CHECK_FREQUENCY,
            )
            db.add(product)
            db.commit()
            db.refresh(product)
        check = record_price(db, product, d.price, d.old_price,
                             d.shipping_cost, d.availability, connector.name)
        item.monitored = True
        item.product_id = product.id
        item.opportunity_level = check.opportunity_level
        item.gap_percent = check.gap_percent
        item.margin_eur = check.margin_eur
    return item


def keyword_search(db: Session, query: str, website_ids: list[int] | None,
                   max_per_site: int, add_to_monitoring: bool) -> dict:
    """Cherche `query` sur chaque site sélectionné disposant d'une recherche
    (connecteur dédié ou URL de recherche renseignée)."""
    sites_q = db.query(models.Website).filter(models.Website.active.is_(True))
    if website_ids:
        sites_q = sites_q.filter(models.Website.id.in_(website_ids))
    sites = sites_q.all()

    items: list[DiscoveredItem] = []
    per_site: list[dict] = []
    skipped = 0

    for site in sites:
        connector = for_domain(site.domain)
        # 1. connecteur dédié avec recherche
        links: list[str] = []
        status = "no_search"
        if connector and connector.search_url_template:
            links, status = connector.search(query, max_per_site)
        # 2. sinon, URL de recherche saisie manuellement sur le site
        elif site.search_url_template:
            search_url = site.search_url_template.replace(
                "{query}", query.replace(" ", "+"))
            html, status = cascade.fetch_raw(
                search_url, site.min_delay, bool(site.needs_playwright))
            if html:
                patterns = tuple(connector.product_url_patterns) if connector else ()
                links = extract_product_links(html, search_url, patterns, max_per_site)
        else:
            skipped += 1
            continue

        if not links:
            per_site.append({"site": site.name, "status": status, "found": 0})
            db.add(models.ScrapingJob(url=site.domain, status=status,
                                      method="search", error=status))
            db.commit()
            continue

        count = 0
        for link in links[:max_per_site]:
            item = _scrape_and_maybe_monitor(db, link, site, None, add_to_monitoring)
            if item and item.price:
                items.append(item)
                count += 1
        per_site.append({"site": site.name, "status": "success", "found": count})

    items.sort(key=lambda i: i.price or 1e12)  # moins cher d'abord
    return {"query": query, "results": [i.__dict__ for i in items],
            "per_site": per_site, "sites_searched": len(sites) - skipped,
            "sites_without_search": skipped}


def discover_from_category(db: Session, category: models.Category,
                           max_items: int, add_to_monitoring: bool) -> dict:
    """Découvre les produits d'une page catégorie/listing (category.watch_url)."""
    if not category.watch_url:
        return {"error": "Cette catégorie n'a pas d'URL de page à surveiller",
                "results": [], "found_links": 0}

    domain = urlparse(category.watch_url).netloc.replace("www.", "")
    site = db.query(models.Website).filter(
        models.Website.domain == domain).first()
    connector = for_domain(domain)

    html, status = cascade.fetch_raw(
        category.watch_url,
        site.min_delay if site else None,
        bool((site and site.needs_playwright) or (connector and connector.needs_playwright)))
    if not html:
        db.add(models.ScrapingJob(url=category.watch_url, status=status,
                                  method="discover", error=status))
        db.commit()
        return {"error": f"Page catégorie inaccessible ({status})",
                "results": [], "found_links": 0}

    patterns = tuple(connector.product_url_patterns) if connector else ()
    links = extract_product_links(html, category.watch_url, patterns, max_items)
    items: list[DiscoveredItem] = []
    for link in links[:max_items]:
        item = _scrape_and_maybe_monitor(db, link, site, category.id,
                                         add_to_monitoring)
        if item and item.price:
            items.append(item)

    items.sort(key=lambda i: (i.opportunity_level != "exceptionnel",
                              -(i.gap_percent or 0)))
    return {"category": category.name, "found_links": len(links),
            "results": [i.__dict__ for i in items]}
