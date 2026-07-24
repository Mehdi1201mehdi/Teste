"""Produits surveillés."""
from datetime import datetime, timedelta
from typing import Annotated

from fastapi import (APIRouter, Depends, File, HTTPException, Query, Response,
                     UploadFile)
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models
from ..config import settings
from ..database import get_db
from ..proxies.manager import ProxyManager, ensure_sources_seeded
from ..scraping.cascade import cascade
from ..services import alerts as alert_service
from ..services.watcher import check_product, record_price
from .schemas import (CategoryIn, DiscoverIn, ManualPriceIn, PreviewIn,
                      ProductIn, ProductUpdate, ProxySourceIn, SearchIn,
                      SettingsIn, WebsiteIn)
from .serializers import check_dict, product_dict

router = APIRouter(prefix="/api")


# ------------------------------------------------------------------- products
@router.get("/products")
def list_products(db: Session = Depends(get_db), active: bool | None = None,
                  search: str = ""):
    q = db.query(models.Product)
    if active is not None:
        q = q.filter(models.Product.active.is_(active))
    if search:
        q = q.filter(models.Product.name.ilike(f"%{search}%"))
    return [product_dict(p) for p in q.order_by(models.Product.created_at.desc()).all()]


@router.post("/products", status_code=201)
def create_product(payload: ProductIn, db: Session = Depends(get_db)):
    if db.query(models.Product).filter(models.Product.url == payload.url).first():
        raise HTTPException(409, "Ce produit (URL) est déjà surveillé")
    product = models.Product(
        url=payload.url.strip(), name=payload.name, image_url=payload.image_url,
        ean=payload.ean, seller=payload.seller,
        category_id=payload.category_id, website_id=payload.website_id,
        market_price=payload.market_price,
        market_price_auto=payload.market_price_auto,
        active=payload.active,
        check_frequency_minutes=payload.check_frequency_minutes
        or settings.DEFAULT_CHECK_FREQUENCY,
    )
    # Rattache automatiquement le site connu correspondant au domaine
    if not product.website_id:
        from urllib.parse import urlparse
        domain = urlparse(product.url).netloc.replace("www.", "")
        site = db.query(models.Website).filter(
            models.Website.domain == domain).first()
        if site:
            product.website_id = site.id
    db.add(product)
    db.commit()
    db.refresh(product)
    if payload.scrape_now:
        check_product(db, product)
        db.refresh(product)
    return product_dict(product)


@router.get("/products/{product_id}")
def get_product(product_id: int, db: Session = Depends(get_db)):
    product = db.get(models.Product, product_id)
    if not product:
        raise HTTPException(404, "Produit introuvable")
    return product_dict(product)


@router.patch("/products/{product_id}")
def update_product(product_id: int, payload: ProductUpdate,
                   db: Session = Depends(get_db)):
    product = db.get(models.Product, product_id)
    if not product:
        raise HTTPException(404, "Produit introuvable")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(product, field, value)
    db.commit()
    db.refresh(product)
    return product_dict(product)


@router.delete("/products/{product_id}", status_code=204)
def delete_product(product_id: int, db: Session = Depends(get_db)):
    product = db.get(models.Product, product_id)
    if not product:
        raise HTTPException(404, "Produit introuvable")
    db.delete(product)
    db.commit()


@router.post("/products/{product_id}/check")
def manual_check(product_id: int, db: Session = Depends(get_db)):
    product = db.get(models.Product, product_id)
    if not product:
        raise HTTPException(404, "Produit introuvable")
    job = check_product(db, product)
    db.refresh(product)
    return {"job": {"status": job.status, "method": job.method,
                    "error": job.error, "duration_ms": job.duration_ms},
            "product": product_dict(product)}


@router.post("/products/{product_id}/price")
def manual_price(product_id: int, payload: ManualPriceIn,
                 db: Session = Depends(get_db)):
    """Saisie manuelle d'un relevé (utile si le site bloque le scraping)."""
    product = db.get(models.Product, product_id)
    if not product:
        raise HTTPException(404, "Produit introuvable")
    check = record_price(db, product, payload.price, payload.old_price,
                         payload.shipping, payload.availability, "manual")
    return check_dict(check)


@router.get("/products/{product_id}/history")
def product_history(product_id: int, db: Session = Depends(get_db),
                    limit: int = 200):
    product = db.get(models.Product, product_id)
    if not product:
        raise HTTPException(404, "Produit introuvable")
    checks = (db.query(models.PriceCheck)
              .filter(models.PriceCheck.product_id == product_id)
              .order_by(models.PriceCheck.created_at.asc())
              .limit(limit).all())
    prices = [c.price for c in checks]
    best = None
    if checks:
        best_check = max(checks, key=lambda c: (c.score, c.gap_percent or 0))
        best = {"date": best_check.created_at.isoformat(),
                "price": best_check.price, "score": best_check.score,
                "level": best_check.opportunity_level}
    return {
        "product": product_dict(product),
        "checks": [check_dict(c) for c in checks],
        "stats": {
            "min_price": min(prices) if prices else None,
            "max_price": max(prices) if prices else None,
            "avg_price": round(sum(prices) / len(prices), 2) if prices else None,
            "best_opportunity": best,
        },
    }
