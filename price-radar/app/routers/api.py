"""API REST : dashboard, opportunités, produits, sites, catégories,
alertes, paramètres, logs, scraping manuel."""
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models
from ..config import settings
from ..database import get_db
from ..proxies.manager import ProxyManager, ensure_sources_seeded
from ..scraping.cascade import cascade
from ..services import alerts as alert_service
from ..services.watcher import check_product, record_price

router = APIRouter(prefix="/api")


# ---------------------------------------------------------------- serializers
def product_dict(p: models.Product) -> dict:
    return {
        "id": p.id, "name": p.name, "url": p.url, "image_url": p.image_url,
        "ean": p.ean, "seller": p.seller,
        "category_id": p.category_id,
        "category": p.category.name if p.category else None,
        "website_id": p.website_id,
        "website": p.website.name if p.website else None,
        "market_price": p.market_price, "market_price_auto": p.market_price_auto,
        "last_price": p.last_price, "last_old_price": p.last_old_price,
        "last_shipping": p.last_shipping, "last_availability": p.last_availability,
        "active": p.active,
        "check_frequency_minutes": p.check_frequency_minutes,
        "last_checked_at": p.last_checked_at.isoformat() if p.last_checked_at else None,
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


def check_dict(c: models.PriceCheck, with_product: bool = False) -> dict:
    data = {
        "id": c.id, "product_id": c.product_id, "price": c.price,
        "old_price": c.old_price, "shipping_cost": c.shipping_cost,
        "currency": c.currency, "availability": c.availability,
        "method": c.method, "market_price": c.market_price,
        "gap_eur": c.gap_eur, "gap_percent": c.gap_percent,
        "margin_eur": c.margin_eur, "margin_percent": c.margin_percent,
        "score": c.score, "opportunity_level": c.opportunity_level,
        "risk_level": c.risk_level,
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }
    if with_product and c.product:
        data["product"] = product_dict(c.product)
    return data


# -------------------------------------------------------------------- schemas
class ProductIn(BaseModel):
    url: str
    name: str = ""
    image_url: str = ""
    ean: str = ""
    seller: str = ""
    category_id: int | None = None
    website_id: int | None = None
    market_price: float | None = None
    market_price_auto: bool = True
    active: bool = True
    check_frequency_minutes: int | None = None
    scrape_now: bool = True


class ProductUpdate(BaseModel):
    name: str | None = None
    image_url: str | None = None
    ean: str | None = None
    seller: str | None = None
    category_id: int | None = None
    website_id: int | None = None
    market_price: float | None = None
    market_price_auto: bool | None = None
    active: bool | None = None
    check_frequency_minutes: int | None = None


class WebsiteIn(BaseModel):
    name: str
    domain: str
    trusted: bool = False
    active: bool = True
    min_delay: float = 2.0
    needs_playwright: bool = False
    search_url_template: str = ""


class SearchIn(BaseModel):
    query: str
    website_ids: list[int] | None = None
    max_per_site: int = 5
    add_to_monitoring: bool = False


class DiscoverIn(BaseModel):
    max_items: int = 20
    add_to_monitoring: bool = True


class CategoryIn(BaseModel):
    name: str
    watch_url: str = ""
    active: bool = True


class SettingsIn(BaseModel):
    alert_min_gap_percent: float | None = None
    alert_min_margin_eur: float | None = None
    alert_only_in_stock: bool | None = None


class ProxySourceIn(BaseModel):
    name: str
    url: str
    protocol: str = "http"
    enabled: bool = True


class PreviewIn(BaseModel):
    url: str


class ManualPriceIn(BaseModel):
    price: float
    old_price: float | None = None
    shipping: float | None = None
    availability: str = "unknown"


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
@router.get("/opportunities")
def opportunities(
    db: Session = Depends(get_db),
    category_id: int | None = None,
    website_id: int | None = None,
    level: str | None = Query(None, pattern="^(faible|moyen|fort|exceptionnel)$"),
    min_margin: float | None = None,
    min_gap_percent: float | None = None,
    min_price: float | None = None,
    max_price: float | None = None,
    availability: str | None = None,
    since_days: int = 30,
    search: str = "",
    sort: str = Query("score", pattern="^(score|margin|price|gap|date|website)$"),
    order: str = Query("desc", pattern="^(asc|desc)$"),
    limit: int = 100,
    offset: int = 0,
):
    q = (db.query(models.PriceCheck)
         .join(models.Product)
         .filter(models.PriceCheck.gap_percent.isnot(None)))
    if since_days:
        q = q.filter(models.PriceCheck.created_at >=
                     datetime.utcnow() - timedelta(days=since_days))
    if category_id:
        q = q.filter(models.Product.category_id == category_id)
    if website_id:
        q = q.filter(models.Product.website_id == website_id)
    if level:
        q = q.filter(models.PriceCheck.opportunity_level == level)
    if min_margin is not None:
        q = q.filter(models.PriceCheck.margin_eur >= min_margin)
    if min_gap_percent is not None:
        q = q.filter(models.PriceCheck.gap_percent >= min_gap_percent)
    if min_price is not None:
        q = q.filter(models.PriceCheck.price >= min_price)
    if max_price is not None:
        q = q.filter(models.PriceCheck.price <= max_price)
    if availability:
        q = q.filter(models.PriceCheck.availability == availability)
    if search:
        q = q.filter(models.Product.name.ilike(f"%{search}%"))

    sort_col = {
        "score": models.PriceCheck.score,
        "margin": models.PriceCheck.margin_eur,
        "price": models.PriceCheck.price,
        "gap": models.PriceCheck.gap_percent,
        "date": models.PriceCheck.created_at,
        "website": models.Product.website_id,
    }[sort]
    q = q.order_by(sort_col.asc() if order == "asc" else sort_col.desc())

    total = q.count()
    rows = q.offset(offset).limit(min(limit, 500)).all()
    return {"total": total,
            "items": [check_dict(c, with_product=True) for c in rows]}


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


# -------------------------------------------------------------------- proxies
@router.get("/proxies/sources")
def list_proxy_sources(db: Session = Depends(get_db)):
    ensure_sources_seeded(db)
    return [{"id": s.id, "name": s.name, "url": s.url, "protocol": s.protocol,
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
