"""Paramètres et logs de scraping."""
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


# ------------------------------------------------------------------- settings
@router.get("/settings")
def get_settings(db: Session = Depends(get_db)):
    return {
        "alert_min_gap_percent": alert_service.get_setting(
            db, "alert_min_gap_percent", settings.ALERT_MIN_GAP_PERCENT),
        "alert_min_margin_eur": alert_service.get_setting(
            db, "alert_min_margin_eur", settings.ALERT_MIN_MARGIN_EUR),
        "alert_only_in_stock": alert_service.get_setting(
            db, "alert_only_in_stock", settings.ALERT_ONLY_IN_STOCK),
        "channels": {
            "email": bool(settings.SMTP_HOST and settings.ALERT_EMAIL_TO),
            "telegram": bool(settings.TELEGRAM_BOT_TOKEN),
            "discord": bool(settings.DISCORD_WEBHOOK_URL),
        },
        "scraping": {
            "respect_robots_txt": settings.RESPECT_ROBOTS_TXT,
            "playwright_fallback": settings.USE_PLAYWRIGHT_FALLBACK,
            "min_delay": settings.SCRAPE_MIN_DELAY,
            "max_delay": settings.SCRAPE_MAX_DELAY,
        },
    }


@router.put("/settings")
def update_settings(payload: SettingsIn, db: Session = Depends(get_db)):
    for key, value in payload.model_dump(exclude_unset=True).items():
        if value is not None:
            alert_service.set_setting(db, key, value)
    return get_settings(db)


# ----------------------------------------------------------------------- logs
@router.get("/logs")
def list_logs(db: Session = Depends(get_db), limit: int = 200,
              status: str | None = None):
    q = db.query(models.ScrapingJob)
    if status:
        q = q.filter(models.ScrapingJob.status == status)
    rows = q.order_by(models.ScrapingJob.created_at.desc()).limit(limit).all()
    return [{"id": j.id, "product_id": j.product_id, "url": j.url,
             "status": j.status, "method": j.method, "error": j.error,
             "duration_ms": j.duration_ms,
             "created_at": j.created_at.isoformat()} for j in rows]
