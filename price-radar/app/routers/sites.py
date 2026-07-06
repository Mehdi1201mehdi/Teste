"""Sites e-commerce et catégories."""
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


# ----------------------------------------------------------- websites & categories
@router.get("/websites")
def list_websites(db: Session = Depends(get_db)):
    return [{"id": w.id, "name": w.name, "domain": w.domain,
             "trusted": w.trusted, "active": w.active,
             "min_delay": w.min_delay, "needs_playwright": w.needs_playwright,
             "search_url_template": w.search_url_template,
             "products": len(w.products)}
            for w in db.query(models.Website).all()]


@router.post("/websites", status_code=201)
def create_website(payload: WebsiteIn, db: Session = Depends(get_db)):
    if db.query(models.Website).filter(
            models.Website.domain == payload.domain).first():
        raise HTTPException(409, "Ce domaine existe déjà")
    site = models.Website(**payload.model_dump())
    db.add(site)
    db.commit()
    db.refresh(site)
    return {"id": site.id}


@router.delete("/websites/{website_id}", status_code=204)
def delete_website(website_id: int, db: Session = Depends(get_db)):
    site = db.get(models.Website, website_id)
    if not site:
        raise HTTPException(404, "Site introuvable")
    db.delete(site)
    db.commit()


@router.get("/categories")
def list_categories(db: Session = Depends(get_db)):
    return [{"id": c.id, "name": c.name, "watch_url": c.watch_url,
             "active": c.active, "products": len(c.products)}
            for c in db.query(models.Category).all()]


@router.post("/categories", status_code=201)
def create_category(payload: CategoryIn, db: Session = Depends(get_db)):
    if db.query(models.Category).filter(
            models.Category.name == payload.name).first():
        raise HTTPException(409, "Cette catégorie existe déjà")
    category = models.Category(**payload.model_dump())
    db.add(category)
    db.commit()
    return {"id": category.id}


@router.post("/categories/{category_id}/discover")
def discover_category(category_id: int, payload: DiscoverIn,
                      db: Session = Depends(get_db)):
    """Découvre les produits d'une page catégorie et (option) les surveille."""
    from ..services.discovery import discover_from_category
    category = db.get(models.Category, category_id)
    if not category:
        raise HTTPException(404, "Catégorie introuvable")
    return discover_from_category(db, category, min(payload.max_items, 50),
                                  payload.add_to_monitoring)


@router.delete("/categories/{category_id}", status_code=204)
def delete_category(category_id: int, db: Session = Depends(get_db)):
    category = db.get(models.Category, category_id)
    if not category:
        raise HTTPException(404, "Catégorie introuvable")
    db.delete(category)
    db.commit()
