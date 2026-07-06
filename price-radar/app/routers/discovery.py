"""Connecteurs, comparateur, recherche, scraping direct."""
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


# ------------------------------------------------------------- API connecteurs
@router.get("/api-connectors")
def list_api_connectors():
    """Connecteurs d'API officielles + statut de configuration."""
    from .. import apiconnectors as api
    return [{"name": c.name, "label": c.label, "kind": c.kind, "docs": c.docs,
             "configured": c.configured,
             "required_env": list(c.required_env)}
            for c in api.all_api_connectors()]


@router.get("/compare")
def compare(q: str, limit: int = 8, sources: str = ""):
    """Compare les offres des API prix configurées pour un mot-clé."""
    from ..services.comparison import search_all_sources
    if not q.strip():
        raise HTTPException(422, "Mot-clé vide")
    only = [s for s in sources.split(",") if s] or None
    return search_all_sources(q.strip(), min(limit, 20), only)


@router.get("/barcode/{ean}")
def barcode_lookup(ean: str):
    """Enrichit un produit par son code-barres (bases ouvertes + offres)."""
    from ..services.comparison import enrich_by_barcode
    if not ean.isdigit():
        raise HTTPException(422, "Code-barres invalide (chiffres attendus)")
    return enrich_by_barcode(ean)


# ----------------------------------------------------------------- connectors
@router.get("/connectors")
def list_connectors():
    """Liste les connecteurs e-commerce disponibles (vrais sites)."""
    from ..connectors import all_connectors
    return [{"name": c.name, "label": c.label,
             "domain": c.domains[0] if c.domains else "",
             "domains": list(c.domains),
             "has_search": bool(c.search_url_template),
             "needs_playwright": c.needs_playwright,
             "trusted": c.trusted}
            for c in all_connectors() if c.name != "generic"]


# --------------------------------------------------------- recherche produits
@router.post("/search")
def search_products(payload: SearchIn, db: Session = Depends(get_db)):
    """Recherche par mot-clé sur les sites configurés (modèle d'URL de
    recherche). Peut prendre du temps : plusieurs sites × plusieurs fiches."""
    from ..services.discovery import keyword_search
    if not payload.query.strip():
        raise HTTPException(422, "Mot-clé vide")
    return keyword_search(db, payload.query.strip(), payload.website_ids,
                          min(payload.max_per_site, 10), payload.add_to_monitoring)


# ------------------------------------------------------------ scraping direct
@router.post("/scrape/preview")
def scrape_preview(payload: PreviewIn):
    """Teste l'extraction sur une URL via son connecteur, sans rien
    enregistrer."""
    from ..connectors import for_url
    connector = for_url(payload.url)
    result = connector.fetch(payload.url)
    if not result.ok or result.product is None:
        return {"ok": False, "connector": connector.name,
                "status": result.status, "error": result.error}
    d = result.product
    return {"ok": True, "connector": connector.name, "method": result.method,
            "data": {"name": d.name, "price": d.price, "old_price": d.old_price,
                     "discount_percent": d.discount_percent,
                     "currency": d.currency, "image_url": d.image_url,
                     "availability": d.availability,
                     "shipping_cost": d.shipping_cost, "seller": d.seller,
                     "ean": d.ean, "brand": d.brand, "mpn": d.mpn,
                     "category": d.category, "sources": d.sources}}
