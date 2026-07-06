"""Tableau de bord et opportunités."""
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


# ------------------------------------------------------------------ dashboard
@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db)):
    week_ago = datetime.utcnow() - timedelta(days=7)
    best = (
        db.query(models.PriceCheck)
        .filter(models.PriceCheck.created_at >= week_ago,
                models.PriceCheck.gap_percent.isnot(None))
        .order_by(models.PriceCheck.score.desc(),
                  models.PriceCheck.gap_percent.desc())
        .limit(200).all()
    )
    # Une seule ligne (la meilleure) par produit
    seen: set[int] = set()
    top = []
    for c in best:
        if c.product_id in seen:
            continue
        seen.add(c.product_id)
        top.append(check_dict(c, with_product=True))
        if len(top) >= 20:
            break

    stats = {
        "products_watched": db.query(models.Product)
                              .filter(models.Product.active.is_(True)).count(),
        "checks_7d": db.query(models.PriceCheck)
                       .filter(models.PriceCheck.created_at >= week_ago).count(),
        "alerts_unread": db.query(models.Alert)
                           .filter(models.Alert.read.is_(False)).count(),
        "opportunities_7d": db.query(models.PriceCheck)
            .filter(models.PriceCheck.created_at >= week_ago,
                    models.PriceCheck.opportunity_level.in_(
                        ["moyen", "fort", "exceptionnel"])).count(),
        "best_margin_7d": db.query(func.max(models.PriceCheck.margin_eur))
            .filter(models.PriceCheck.created_at >= week_ago).scalar() or 0,
    }
    return {"stats": stats, "top_opportunities": top}


# -------------------------------------------------------------- opportunities
class OpportunityFilters(BaseModel):
    category_id: int | None = None
    website_id: int | None = None
    level: str | None = Field(None, pattern="^(faible|moyen|fort|exceptionnel)$")
    min_margin: float | None = None
    min_gap_percent: float | None = None
    min_price: float | None = None
    max_price: float | None = None
    availability: str | None = None
    since_days: int = 30
    search: str = ""
    sort: str = Field("score", pattern="^(score|margin|price|gap|date|website)$")
    order: str = Field("desc", pattern="^(asc|desc)$")
    limit: int = 100
    offset: int = 0


_OPP_SORT_COLUMNS = {
    "score": models.PriceCheck.score,
    "margin": models.PriceCheck.margin_eur,
    "price": models.PriceCheck.price,
    "gap": models.PriceCheck.gap_percent,
    "date": models.PriceCheck.created_at,
    "website": models.Product.website_id,
}


def _apply_opportunity_filters(q, f: OpportunityFilters):
    """Applique les filtres de la requête opportunités (data-driven)."""
    for value, col in ((f.category_id, models.Product.category_id),
                       (f.website_id, models.Product.website_id),
                       (f.level, models.PriceCheck.opportunity_level),
                       (f.availability, models.PriceCheck.availability)):
        if value:
            q = q.filter(col == value)
    for value, col in ((f.min_margin, models.PriceCheck.margin_eur),
                       (f.min_gap_percent, models.PriceCheck.gap_percent),
                       (f.min_price, models.PriceCheck.price)):
        if value is not None:
            q = q.filter(col >= value)
    if f.max_price is not None:
        q = q.filter(models.PriceCheck.price <= f.max_price)
    if f.since_days:
        q = q.filter(models.PriceCheck.created_at >=
                     datetime.utcnow() - timedelta(days=f.since_days))
    if f.search:
        q = q.filter(models.Product.name.ilike(f"%{f.search}%"))
    return q


@router.get("/opportunities")
def opportunities(filters: Annotated[OpportunityFilters, Query()],
                  db: Session = Depends(get_db)):
    q = (db.query(models.PriceCheck)
         .join(models.Product)
         .filter(models.PriceCheck.gap_percent.isnot(None)))
    q = _apply_opportunity_filters(q, filters)
    col = _OPP_SORT_COLUMNS[filters.sort]
    q = q.order_by(col.asc() if filters.order == "asc" else col.desc())
    total = q.count()
    rows = q.offset(filters.offset).limit(min(filters.limit, 500)).all()
    return {"total": total,
            "items": [check_dict(c, with_product=True) for c in rows]}
