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


def start_scheduler():
    scheduler.add_job(run_due_checks, "interval", minutes=1,
                      id="due-checks", max_instances=1, coalesce=True)
    if settings.PROXY_POOL_ENABLED:
        scheduler.add_job(run_proxy_refresh, "interval",
                          minutes=settings.PROXY_REFRESH_MINUTES,
                          id="proxy-refresh", max_instances=1, coalesce=True,
                          next_run_time=datetime.utcnow() + timedelta(seconds=10))
    scheduler.start()
    logger.info("Scheduler démarré (vérifications + %s)",
                "pool de proxies actif" if settings.PROXY_POOL_ENABLED
                else "pool de proxies désactivé")


def stop_scheduler():
    if scheduler.running:
        scheduler.shutdown(wait=False)
