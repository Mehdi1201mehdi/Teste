"""Vérification d'un produit : scraping → relevé de prix → détection
d'opportunité → alerte éventuelle. Avec anti-doublons et logs."""
import logging
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from .. import models
from ..connectors import for_url as connector_for_url
from . import alerts as alert_service
from .opportunity import evaluate

logger = logging.getLogger("price-radar.watcher")

# Anti-doublon : on ne recrée pas d'alerte pour le même produit au même
# niveau dans cette fenêtre.
ALERT_DEDUP_HOURS = 24


def _is_duplicate_alert(db: Session, product_id: int, level: str) -> bool:
    since = datetime.utcnow() - timedelta(hours=ALERT_DEDUP_HOURS)
    return db.query(models.Alert).filter(
        models.Alert.product_id == product_id,
        models.Alert.level == level,
        models.Alert.created_at >= since,
    ).count() > 0


def record_price(db: Session, product: models.Product, price: float,
                 old_price: float | None = None,
                 shipping: float | None = None,
                 availability: str = "unknown",
                 method: str = "manual") -> models.PriceCheck:
    """Enregistre un relevé de prix + détection. Utilisé par le scraping,
    le seed et l'API. L'évaluation se fait AVANT insertion pour comparer
    à l'historique existant."""
    result = evaluate(db, product, price, shipping, availability)

    check = models.PriceCheck(
        product_id=product.id,
        price=price,
        old_price=old_price,
        shipping_cost=shipping,
        availability=availability,
        method=method,
        market_price=result.market_price,
        gap_eur=result.gap_eur,
        gap_percent=result.gap_percent,
        margin_eur=result.margin_eur,
        margin_percent=result.margin_percent,
        score=result.score,
        opportunity_level=result.level,
        risk_level=result.risk,
    )
    db.add(check)

    product.last_price = price
    product.last_old_price = old_price
    product.last_shipping = shipping
    product.last_availability = availability
    product.last_checked_at = datetime.utcnow()
    if product.market_price_auto and result.market_price:
        product.market_price = result.market_price
    db.commit()
    db.refresh(check)

    if alert_service.should_alert(db, result, availability) and \
            not _is_duplicate_alert(db, product.id, result.level):
        alert_service.create_alert(db, product, check, result)
        logger.info("Alerte créée pour produit #%s (%s)", product.id, result.level)

    return check


def check_product(db: Session, product: models.Product) -> models.ScrapingJob:
    """Scrape l'URL du produit et enregistre le résultat + un log de job."""
    job = models.ScrapingJob(product_id=product.id, url=product.url,
                             status="pending")
    db.add(job)
    db.commit()

    # Le connecteur du site (ou générique) gère la récupération publique
    connector = connector_for_url(product.url)
    result = connector.fetch(product.url)

    job.method = f"{connector.name}:{result.method}" if result.method else connector.name

    if not result.ok or result.product is None:
        job.status = result.status
        job.error = result.error
        product.last_checked_at = datetime.utcnow()
        db.commit()
        logger.warning("Scraping échoué pour %s (%s) : %s",
                       product.url, connector.name, result.error)
        return job

    data = result.product
    # Enrichit la fiche produit si des champs manquent
    if data.name and not product.name:
        product.name = data.name
    if data.image_url and not product.image_url:
        product.image_url = data.image_url
    if data.ean and not product.ean:
        product.ean = data.ean
    if data.seller and not product.seller:
        product.seller = data.seller

    # Anti-doublon relevés : si le prix n'a pas bougé depuis le dernier
    # relevé de moins d'une heure, on ne réinsère pas.
    last = (db.query(models.PriceCheck)
            .filter(models.PriceCheck.product_id == product.id)
            .order_by(models.PriceCheck.created_at.desc()).first())
    if last and last.price == data.price and \
            (datetime.utcnow() - last.created_at) < timedelta(hours=1):
        job.status = "success"
        job.error = "prix inchangé (doublon ignoré)"
        product.last_checked_at = datetime.utcnow()
        db.commit()
        return job

    record_price(db, product, data.price, data.old_price,
                 data.shipping_cost, data.availability, job.method)
    job.status = "success"
    db.commit()
    return job


def due_products(db: Session) -> list[models.Product]:
    """Produits actifs dont la fréquence de vérification est écoulée."""
    now = datetime.utcnow()
    products = db.query(models.Product).filter(models.Product.active.is_(True)).all()
    due = []
    for product in products:
        if product.last_checked_at is None:
            due.append(product)
            continue
        freq = timedelta(minutes=product.check_frequency_minutes or 360)
        if now - product.last_checked_at >= freq:
            due.append(product)
    return due
