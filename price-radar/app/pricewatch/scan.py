"""Orchestrateur de la Veille prix.

Pour chaque produit surveillé : récupère le prix via le connecteur du site
(API/HTML public, JSON-LD, schema.org), calcule la baisse (prix barré),
applique les règles, score l'opportunité et crée une alerte si seuil atteint.

Conformité : aucun contournement anti-bot. Si un site bloque, le produit est
marqué « source non disponible » (statut blocked/robots_denied) et on passe
au suivant. Délais polis, retries limités, logs.
"""
import logging
import time
from datetime import datetime

from sqlalchemy.orm import Session

from .. import models
from ..connectors import for_url as connector_for_url
from ..services.watcher import _is_duplicate_alert, record_price
from . import scoring
from .config import get_config

logger = logging.getLogger("price-radar.pricewatch.scan")


def analyze_check(db: Session, product: models.Product,
                  check: models.PriceCheck, cfg: dict) -> dict:
    """Calcule baisse, score, règle et alerte pour un relevé donné."""
    amount, percent = scoring.compute_discount(check.old_price, check.price)
    available = check.availability == "in_stock"
    suspicious = scoring.is_suspicious(check.old_price, check.price, percent, cfg)
    ok = scoring.passes_rules(percent, amount, available, suspicious, cfg)

    history_count = (db.query(models.PriceCheck)
                     .filter(models.PriceCheck.product_id == product.id).count())
    trusted = bool(product.website and product.website.trusted)
    has_ean = bool(product.ean)
    score = scoring.opportunity_score(percent or 0, amount or 0, available,
                                      trusted, has_ean, history_count) if ok else 0
    level = scoring.classify_alert(percent, cfg) if ok else None

    if ok and level and cfg["enableAlerts"] and \
            not _is_duplicate_alert(db, product.id, level):
        title = f"⬇️ {level} · {product.name or product.url} −{percent:.0f}%"
        message = (
            f"Produit : {product.name or product.url}\n"
            f"Source : {product.website.name if product.website else product.seller}\n"
            f"Ancien prix : {check.old_price:.2f} €\n"
            f"Prix actuel : {check.price:.2f} €\n"
            f"Baisse : {amount:.2f} € ({percent:.0f} %)\n"
            f"Disponibilité : {check.availability}\n"
            f"Score opportunité : {score}/100\n"
            f"Action conseillée : {scoring.advice(level)}\n"
            f"Lien : {product.url}")
        db.add(models.Alert(product_id=product.id, price_check_id=check.id,
                            title=title, message=message, level=level))
        db.commit()

    return {"discount_amount": amount, "discount_percent": percent,
            "available": available, "suspicious": suspicious, "passes": ok,
            "score": score, "level": level}


def scan(db: Session, product_ids: list[int] | None = None,
         website_id: int | None = None) -> dict:
    """Scanne les produits surveillés (bornés par maxProductsPerSource)."""
    cfg = get_config(db)
    q = db.query(models.Product).filter(models.Product.active.is_(True))
    if product_ids:
        q = q.filter(models.Product.id.in_(product_ids))
    if website_id:
        q = q.filter(models.Product.website_id == website_id)
    products = q.limit(cfg["maxProductsPerSource"] * 5).all()

    start = time.time()
    scanned = discounts = alerts = unavailable = 0
    delay = max(0.0, cfg["scanDelayMs"] / 1000.0)

    for product in products:
        connector = connector_for_url(product.url)
        result = connector.fetch(product.url)
        scanned += 1
        if not result.ok or result.product is None:
            unavailable += 1
            db.add(models.ScrapingJob(product_id=product.id, url=product.url,
                                      status="source_indisponible",
                                      method=connector.name, error=result.error))
            db.commit()
            time.sleep(delay)
            continue

        d = result.product
        check = record_price(db, product, d.price, d.old_price,
                             d.shipping_cost, d.availability, connector.name)
        analysis = analyze_check(db, product, check, cfg)
        if analysis["passes"]:
            discounts += 1
        if analysis["level"]:
            alerts += 1
        time.sleep(delay)

    duration = int((time.time() - start) * 1000)
    db.add(models.ScrapingJob(url="pricewatch:scan", status="success",
                              method="scan", duration_ms=duration,
                              error=f"{scanned} scannés, {discounts} baisses, "
                                    f"{alerts} alertes, {unavailable} indispo"))
    db.commit()
    return {"scanned": scanned, "discounts_found": discounts, "alerts": alerts,
            "unavailable": unavailable, "duration_ms": duration}


def build_discount_rows(db: Session, cfg: dict, only_passing: bool = True,
                        website_id: int | None = None, category_id: int | None = None,
                        brand: str = "", min_percent: float | None = None,
                        availability: str = "", limit: int = 200) -> list[dict]:
    """Dernier relevé par produit → lignes de baisse (baisse €/%, score…)."""
    products = db.query(models.Product).all()
    rows = []
    for product in products:
        if website_id and product.website_id != website_id:
            continue
        if category_id and product.category_id != category_id:
            continue
        last = (db.query(models.PriceCheck)
                .filter(models.PriceCheck.product_id == product.id)
                .order_by(models.PriceCheck.created_at.desc()).first())
        if not last:
            continue
        amount, percent = scoring.compute_discount(last.old_price, last.price)
        if amount is None:
            continue
        available = last.availability == "in_stock"
        suspicious = scoring.is_suspicious(last.old_price, last.price, percent, cfg)
        passes = scoring.passes_rules(percent, amount, available, suspicious, cfg)
        if only_passing and not passes:
            continue
        if min_percent is not None and (percent or 0) < min_percent:
            continue
        if availability and last.availability != availability:
            continue
        if brand and brand.lower() not in (product.name or "").lower() \
                and brand.lower() not in (product.seller or "").lower():
            continue
        history_count = (db.query(models.PriceCheck)
                         .filter(models.PriceCheck.product_id == product.id).count())
        trusted = bool(product.website and product.website.trusted)
        score = scoring.opportunity_score(percent or 0, amount or 0, available,
                                          trusted, bool(product.ean), history_count)
        level = scoring.classify_alert(percent, cfg)
        rows.append({
            "product_id": product.id, "name": product.name or product.url,
            "brand": product.seller or "", "category":
                product.category.name if product.category else "",
            "source": product.website.name if product.website else product.seller,
            "ean": product.ean, "url": product.url, "image": product.image_url,
            "old_price": last.old_price, "current_price": last.price,
            "discount_amount": amount, "discount_percent": percent,
            "availability": last.availability, "score": score, "level": level,
            "advice": scoring.advice(level),
            "scanned_at": last.created_at.isoformat() if last.created_at else None,
        })
    rows.sort(key=lambda r: r["score"], reverse=True)
    return rows[:limit]
