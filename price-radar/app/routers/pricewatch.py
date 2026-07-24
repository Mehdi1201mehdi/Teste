"""Veille prix (baisses, repricing, deals)."""
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


# ------------------------------------------------------------- Veille prix
@router.get("/pricewatch/config")
def pricewatch_get_config(db: Session = Depends(get_db)):
    from ..pricewatch import get_config
    return get_config(db)


@router.put("/pricewatch/config")
def pricewatch_set_config(payload: dict, db: Session = Depends(get_db)):
    from ..pricewatch import set_config
    return set_config(db, payload)


@router.get("/pricewatch/keyword")
def pricewatch_keyword(q: str, limit: int = 10, db: Session = Depends(get_db)):
    """Tape un mot-clé (PC gaming, TV, bricolage) → produits en forte baisse."""
    from ..pricewatch.keyword import keyword_deals
    if not q.strip():
        raise HTTPException(422, "Mot-clé vide")
    return keyword_deals(db, q.strip(), min(limit, 20))


@router.get("/pricewatch/deals")
def pricewatch_deals(min_discount: float = 20, merchant: str = ""):
    """Baisses du jour : récolte les flux RSS de bons plans (Amazon/Cdiscount…),
    classées par plus forte baisse. Sans clé, sans scraper les sites protégés."""
    from ..pricewatch.deals import harvest
    return harvest(min_discount, 100, merchant)


@router.get("/pricewatch/deals/export")
def pricewatch_deals_export(min_discount: float = 20, merchant: str = "",
                            format: str = "csv"):
    from ..datasources.exports import EXPORTS
    from ..pricewatch.deals import harvest
    if format not in EXPORTS:
        raise HTTPException(422, "Format : json | csv | xlsx")
    data = harvest(min_discount, 100, merchant)
    rows = [{"Produit": d["name"], "Marchand": d["merchant"],
             "Prix": d["price"], "Ancien prix": d["old_price"],
             "Baisse %": d["discount_percent"], "URL": d["url"],
             "Flux": d["feed"]} for d in data["deals"]]
    fn, media_type, ext = EXPORTS[format]
    return Response(content=fn(rows), media_type=media_type, headers={
        "Content-Disposition": f'attachment; filename="baisses-du-jour.{ext}"'})


@router.get("/pricewatch/repricing/template")
def repricing_template():
    """Télécharge le modèle Excel/CSV à remplir."""
    from ..pricewatch.repricing import template_csv
    return Response(content=template_csv(), media_type="text/csv", headers={
        "Content-Disposition": 'attachment; filename="modele-repricing.csv"'})


# Dernier résultat de repricing (mémoire process) pour l'export
_LAST_REPRICING: list[dict] = []


@router.post("/pricewatch/repricing")
async def repricing_analyze(file: UploadFile = File(...),
                            db: Session = Depends(get_db)):
    """Analyse ton fichier Excel/CSV : quel produit baisser / augmenter."""
    from ..pricewatch import get_config
    from ..pricewatch.repricing import analyze
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(413, "Fichier trop volumineux (max 10 Mo)")
    result = analyze(content, file.filename or "fichier.csv", get_config(db))
    if result.get("ok"):
        global _LAST_REPRICING
        _LAST_REPRICING = result["rows"]
    return result


@router.get("/pricewatch/repricing/export")
def repricing_export(format: str = "xlsx"):
    """Exporte la dernière analyse de repricing."""
    from ..datasources.exports import EXPORTS
    if format not in EXPORTS:
        raise HTTPException(422, "Format : json | csv | xlsx")
    if not _LAST_REPRICING:
        raise HTTPException(404, "Analyse d'abord un fichier.")
    rows = [{
        "Produit": r["name"], "EAN": r["ean"], "Concurrent": r["competitor"],
        "Mon prix": r["my_price"], "Prix concurrent": r["competitor_price"],
        "Écart €": r["gap"], "Écart %": r["gap_percent"],
        "Action": r["action"], "Prix conseillé": r["target_price"],
        "Raison": r["reason"],
    } for r in _LAST_REPRICING]
    fn, media_type, ext = EXPORTS[format]
    return Response(content=fn(rows), media_type=media_type, headers={
        "Content-Disposition": f'attachment; filename="repricing.{ext}"'})


@router.get("/pricewatch/export")
def pricewatch_export(q: str, format: str = "csv", limit: int = 20,
                      db: Session = Depends(get_db)):
    """Exporte les baisses d'un mot-clé en CSV / Excel / JSON."""
    from ..datasources.exports import EXPORTS
    from ..pricewatch.keyword import keyword_deals
    if format not in EXPORTS:
        raise HTTPException(422, "Format : json | csv | xlsx")
    if not q.strip():
        raise HTTPException(422, "Mot-clé vide")
    data = keyword_deals(db, q.strip(), min(limit, 20))
    rows = [{
        "Produit": d["name"], "Marque": d.get("brand", ""),
        "Catégorie": d.get("category", ""), "Source": d["source"],
        "Ancien prix": d["old_price"], "Prix actuel": d["price"],
        "Baisse €": d["discount_amount"], "Baisse %": d["discount_percent"],
        "Disponibilité": d["availability"], "URL": d["url"],
        "Date du scan": d.get("scanned_at", ""),
        "Score opportunité": d["score"],
    } for d in data["deals"]]
    fn, media_type, ext = EXPORTS[format]
    content = fn(rows)
    safe = "".join(c for c in q if c.isalnum()) or "veille"
    return Response(content=content, media_type=media_type, headers={
        "Content-Disposition": f'attachment; filename="baisses-{safe}.{ext}"'})
