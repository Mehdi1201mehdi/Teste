"""Pool de proxies."""
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


# -------------------------------------------------------------------- proxies
@router.get("/proxies/sources")
def list_proxy_sources(db: Session = Depends(get_db)):
    ensure_sources_seeded(db)
    return [{"id": s.id, "name": s.name, "url": s.url, "protocol": s.protocol,
             "format": getattr(s, "format", "text"),
             "enabled": s.enabled, "last_count": s.last_count,
             "last_error": s.last_error,
             "last_fetched_at": s.last_fetched_at.isoformat() if s.last_fetched_at else None}
            for s in db.query(models.ProxySource).order_by(models.ProxySource.name).all()]


@router.post("/proxies/sources", status_code=201)
def add_proxy_source(payload: ProxySourceIn, db: Session = Depends(get_db)):
    if payload.protocol not in ("http", "https", "socks4", "socks5", "auto"):
        raise HTTPException(422, "Protocole invalide")
    if db.query(models.ProxySource).filter(
            models.ProxySource.name == payload.name).first():
        raise HTTPException(409, "Une source porte déjà ce nom")
    src = models.ProxySource(**payload.model_dump())
    db.add(src)
    db.commit()
    return {"id": src.id}


@router.put("/proxies/sources/{source_id}/toggle")
def toggle_proxy_source(source_id: int, db: Session = Depends(get_db)):
    src = db.get(models.ProxySource, source_id)
    if not src:
        raise HTTPException(404, "Source introuvable")
    src.enabled = not src.enabled
    db.commit()
    return {"id": src.id, "enabled": src.enabled}


@router.delete("/proxies/sources/{source_id}", status_code=204)
def delete_proxy_source(source_id: int, db: Session = Depends(get_db)):
    src = db.get(models.ProxySource, source_id)
    if not src:
        raise HTTPException(404, "Source introuvable")
    db.delete(src)
    db.commit()


@router.get("/proxies")
def list_proxies(db: Session = Depends(get_db), alive_only: bool = True,
                 protocol: str | None = None, limit: int = 100):
    q = db.query(models.Proxy)
    if alive_only:
        q = q.filter(models.Proxy.alive.is_(True))
    if protocol:
        q = q.filter(models.Proxy.protocol == protocol)
    rows = q.order_by(models.Proxy.score.desc()).limit(min(limit, 1000)).all()
    return [{"id": p.id, "url": p.url, "protocol": p.protocol,
             "host": p.host, "port": p.port, "alive": p.alive,
             "latency_ms": p.latency_ms, "score": p.score,
             "success_count": p.success_count, "fail_count": p.fail_count,
             "last_checked_at": p.last_checked_at.isoformat() if p.last_checked_at else None}
            for p in rows]


@router.get("/proxies/stats")
def proxy_stats(db: Session = Depends(get_db)):
    total = db.query(models.Proxy).count()
    alive = db.query(models.Proxy).filter(models.Proxy.alive.is_(True)).count()
    by_proto = {}
    for proto in ("http", "https", "socks4", "socks5"):
        by_proto[proto] = db.query(models.Proxy).filter(
            models.Proxy.protocol == proto, models.Proxy.alive.is_(True)).count()
    best = (db.query(models.Proxy).filter(models.Proxy.alive.is_(True))
            .order_by(models.Proxy.latency_ms.asc()).first())
    return {"enabled": settings.PROXY_POOL_ENABLED, "total": total, "alive": alive,
            "alive_by_protocol": by_proto,
            "refresh_minutes": settings.PROXY_REFRESH_MINUTES,
            "test_limit_per_cycle": settings.PROXY_TEST_LIMIT,
            "best_latency_ms": best.latency_ms if best else None}


@router.post("/proxies/refresh")
def refresh_proxies():
    """Lance un cycle complet (télécharge, fusionne, teste, score, purge).
    Synchrone — peut prendre plusieurs dizaines de secondes."""
    summary = ProxyManager().refresh()
    return {"ok": True, "summary": summary}


@router.post("/proxies/sources/reload")
def reload_proxy_sources(db: Session = Depends(get_db)):
    """Importe les nouvelles sources de proxy_sources.json (par nom), sans
    toucher aux sources existantes."""
    from ..proxies.manager import reload_sources_from_file
    added = reload_sources_from_file(db)
    return {"ok": True, "added": added}


@router.get("/proxies/ip-check")
def proxies_ip_check(proxy: str = ""):
    """Vérifie l'IP publique du scan, directement ou via un proxy donné
    (ex. http://1.2.3.4:8080). Utile pour confirmer la rotation d'IP."""
    from ..proxies.ipcheck import check
    return check(proxy or None)
