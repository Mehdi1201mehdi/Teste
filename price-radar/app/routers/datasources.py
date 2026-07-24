"""Module Sources API gratuites."""
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


# ----------------------------------------------- Module "Sources API gratuites"
class ApiKeyIn(BaseModel):
    env_key: str
    value: str


class CollectIn(BaseModel):
    path: str | None = None


def _log_ds(db, source_id, action, res):
    db.add(models.ApiCollectLog(
        source_id=source_id, action=action,
        status=res.get("status", ""), http=res.get("http"),
        duration_ms=res.get("ms"), count=res.get("count"),
        message=(res.get("message", "") or "")[:500]))
    db.commit()


@router.get("/datasources/categories")
def datasource_categories():
    from ..datasources import categories
    return categories()


@router.get("/datasources")
def datasources(db: Session = Depends(get_db), category: str | None = None,
                search: str = ""):
    from ..datasources import list_sources
    return list_sources(db, category, search)


@router.get("/datasources/autocollect")
def datasource_autocollect_status():
    return {"enabled": settings.DATASOURCE_AUTO_COLLECT,
            "minutes": settings.DATASOURCE_COLLECT_MINUTES}


@router.post("/datasources/{source_id}/test")
def datasource_test(source_id: str, db: Session = Depends(get_db)):
    from ..datasources import connector, get_source
    source = get_source(source_id)
    if not source:
        raise HTTPException(404, "Source inconnue")
    res = connector.testConnection(source, db)
    _log_ds(db, source_id, "test", res)
    return res


@router.post("/datasources/{source_id}/collect")
def datasource_collect(source_id: str, payload: CollectIn,
                       db: Session = Depends(get_db)):
    from ..datasources import connector, get_source
    source = get_source(source_id)
    if not source:
        raise HTTPException(404, "Source inconnue")
    state = db.get(models.ApiSourceState, source_id)
    if state and not state.enabled:
        raise HTTPException(409, "Source désactivée")
    res = connector.fetchData(source, payload.path, db)
    _log_ds(db, source_id, "collect", res)
    if res.get("ok"):
        from ..datasources.store import save_result
        save_result(db, source_id, res["records"])
    return res


@router.post("/datasources/collect-all")
def datasource_collect_all(db: Session = Depends(get_db)):
    """Collecte immédiatement toutes les sources API prêtes (activées + clé
    OK + endpoint défini). Le pendant manuel de l'auto-collecte."""
    from ..datasources import connector, get_source, list_sources
    from ..datasources.store import save_result
    done, skipped = 0, 0
    for row in list_sources(db):
        if (row["kind"] != "api" or not row["enabled"]
                or not row["configured"] or not row["has_test"]):
            skipped += 1
            continue
        source = get_source(row["id"])
        res = connector.fetchData(source, None, db)
        _log_ds(db, source_id=row["id"], action="collect", res=res)
        if res.get("ok"):
            save_result(db, row["id"], res["records"])
            done += 1
    return {"ok": True, "collected": done, "skipped": skipped}


@router.put("/datasources/{source_id}/toggle")
def datasource_toggle(source_id: str, db: Session = Depends(get_db)):
    from ..datasources import get_source
    if not get_source(source_id):
        raise HTTPException(404, "Source inconnue")
    state = db.get(models.ApiSourceState, source_id)
    if state is None:
        state = models.ApiSourceState(source_id=source_id, enabled=False)
        db.add(state)
    else:
        state.enabled = not state.enabled
    db.commit()
    return {"source_id": source_id, "enabled": state.enabled}


@router.post("/datasources/keys")
def datasource_set_key(payload: ApiKeyIn, db: Session = Depends(get_db)):
    """Enregistre une clé API côté serveur (table settings). La valeur n'est
    JAMAIS renvoyée : on confirme seulement qu'elle est configurée."""
    if not payload.env_key or not payload.value:
        raise HTTPException(422, "env_key et value requis")
    alert_service.set_setting(db, f"apikey:{payload.env_key}", payload.value)
    return {"env_key": payload.env_key, "configured": True}


@router.get("/datasources/logs")
def datasource_logs(db: Session = Depends(get_db), limit: int = 100):
    rows = (db.query(models.ApiCollectLog)
            .order_by(models.ApiCollectLog.created_at.desc())
            .limit(min(limit, 500)).all())
    return [{"id": r.id, "source_id": r.source_id, "action": r.action,
             "status": r.status, "http": r.http, "duration_ms": r.duration_ms,
             "count": r.count, "message": r.message,
             "created_at": r.created_at.isoformat()} for r in rows]


@router.get("/datasources/{source_id}/export")
def datasource_export(source_id: str, format: str = "json",
                      db: Session = Depends(get_db)):
    from ..datasources.exports import EXPORTS
    from ..datasources.store import get_result
    if format not in EXPORTS:
        raise HTTPException(422, "Format : json | csv | xlsx")
    records = get_result(db, source_id)
    if not records:
        raise HTTPException(404, "Aucun résultat à exporter — lance d'abord "
                                 "une collecte sur cette source.")
    fn, media_type, ext = EXPORTS[format]
    content = fn(records)
    _log_ds(db, source_id, "export", {"status": "ok", "count": len(records)})
    return Response(content=content, media_type=media_type, headers={
        "Content-Disposition": f'attachment; filename="{source_id}.{ext}"'})
