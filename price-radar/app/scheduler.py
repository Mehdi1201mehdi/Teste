"""Tâches automatiques : vérifie périodiquement les produits surveillés.
Les produits sont traités séquentiellement — les délais par domaine du
PoliteRequester s'appliquent, on ne surcharge jamais un site."""
import logging
from datetime import datetime, timedelta

from apscheduler.schedulers.background import BackgroundScheduler

from .config import settings
from .database import SessionLocal
from .proxies import ProxyManager
from .services.watcher import check_product, due_products

logger = logging.getLogger("price-radar.scheduler")

scheduler = BackgroundScheduler(timezone="UTC")


def run_due_checks():
    db = SessionLocal()
    try:
        products = due_products(db)
        if not products:
            return
        logger.info("Vérification de %d produit(s)…", len(products))
        for product in products:
            try:
                check_product(db, product)
            except Exception:
                logger.exception("Échec de vérification du produit #%s", product.id)
    finally:
        db.close()


def run_proxy_refresh():
    try:
        ProxyManager().refresh()
    except Exception:
        logger.exception("Échec du rafraîchissement du pool de proxies")


def run_datasource_autocollect():
    """Collecte automatiquement les sources API prêtes (activées + clé OK +
    endpoint de test défini). Aucune intervention requise."""
    from . import models
    from .datasources import connector, get_source, list_sources
    from .datasources.store import save_result

    db = SessionLocal()
    collected = 0
    try:
        for row in list_sources(db):
            if (row["kind"] != "api" or not row["enabled"]
                    or not row["configured"] or not row["has_test"]):
                continue
            source = get_source(row["id"])
            try:
                res = connector.fetchData(source, None, db)
            except Exception:
                logger.exception("Auto-collecte échouée : %s", row["id"])
                continue
            db.add(models.ApiCollectLog(
                source_id=row["id"], action="auto-collect",
                status=res.get("status", ""), http=res.get("http"),
                count=res.get("count"), message=(res.get("message", "") or "")[:300]))
            db.commit()
            if res.get("ok"):
                save_result(db, row["id"], res["records"])
                collected += 1
        if collected:
            logger.info("Auto-collecte : %d source(s) collectée(s)", collected)
    finally:
        db.close()


def start_scheduler():
    scheduler.add_job(run_due_checks, "interval", minutes=1,
                      id="due-checks", max_instances=1, coalesce=True)
    if settings.PROXY_POOL_ENABLED:
        scheduler.add_job(run_proxy_refresh, "interval",
                          minutes=settings.PROXY_REFRESH_MINUTES,
                          id="proxy-refresh", max_instances=1, coalesce=True,
                          next_run_time=datetime.utcnow() + timedelta(seconds=10))
    if settings.DATASOURCE_AUTO_COLLECT:
        scheduler.add_job(run_datasource_autocollect, "interval",
                          minutes=settings.DATASOURCE_COLLECT_MINUTES,
                          id="datasource-autocollect", max_instances=1,
                          coalesce=True,
                          next_run_time=datetime.utcnow() + timedelta(seconds=20))
    scheduler.start()
    logger.info("Scheduler démarré (vérifications + %s)",
                "pool de proxies actif" if settings.PROXY_POOL_ENABLED
                else "pool de proxies désactivé")


def stop_scheduler():
    if scheduler.running:
        scheduler.shutdown(wait=False)
