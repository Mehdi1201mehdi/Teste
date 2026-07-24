"""Alertes."""
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


# --------------------------------------------------------------------- alerts
@router.get("/alerts")
def list_alerts(db: Session = Depends(get_db), unread_only: bool = False,
                limit: int = 100):
    q = db.query(models.Alert)
    if unread_only:
        q = q.filter(models.Alert.read.is_(False))
    rows = q.order_by(models.Alert.created_at.desc()).limit(limit).all()
    return [{"id": a.id, "product_id": a.product_id, "title": a.title,
             "message": a.message, "level": a.level, "read": a.read,
             "sent_email": a.sent_email, "sent_telegram": a.sent_telegram,
             "sent_discord": a.sent_discord,
             "created_at": a.created_at.isoformat()} for a in rows]


@router.post("/alerts/{alert_id}/read")
def mark_alert_read(alert_id: int, db: Session = Depends(get_db)):
    alert = db.get(models.Alert, alert_id)
    if not alert:
        raise HTTPException(404, "Alerte introuvable")
    alert.read = True
    db.commit()
    return {"ok": True}


@router.post("/alerts/read-all")
def mark_all_read(db: Session = Depends(get_db)):
    db.query(models.Alert).update({models.Alert.read: True})
    db.commit()
    return {"ok": True}
