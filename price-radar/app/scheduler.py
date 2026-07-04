"""Tâches automatiques : vérifie périodiquement les produits surveillés.
Les produits sont traités séquentiellement — les délais par domaine du
PoliteRequester s'appliquent, on ne surcharge jamais un site."""
import logging

from apscheduler.schedulers.background import BackgroundScheduler

from .database import SessionLocal
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


def start_scheduler():
    scheduler.add_job(run_due_checks, "interval", minutes=1,
                      id="due-checks", max_instances=1, coalesce=True)
    scheduler.start()
    logger.info("Scheduler démarré (vérification chaque minute des produits dus)")


def stop_scheduler():
    if scheduler.running:
        scheduler.shutdown(wait=False)
