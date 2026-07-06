"""Point d'entrée FastAPI : API + fichiers statiques (SPA)."""
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import settings
from .database import Base, engine, run_light_migrations
from .routers import (alerts, catalog, datasources, discovery, pricewatch,
                      products, proxies, settings_logs, sites)
from .scheduler import start_scheduler, stop_scheduler

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    run_light_migrations()
    # Synchronise les vrais sites e-commerce (connecteurs) dans la BDD
    from .connectors import sync_connectors_to_db
    from .database import SessionLocal
    db = SessionLocal()
    try:
        added = sync_connectors_to_db(db)
        if added:
            logging.getLogger("price-radar").info(
                "%d connecteur(s) e-commerce synchronisé(s)", added)
    finally:
        db.close()
    if settings.SCHEDULER_ENABLED:
        start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(title="Price Radar",
              description="Détecteur d'erreurs de prix et d'opportunités e-commerce",
              lifespan=lifespan)
for _module in (catalog, products, sites, alerts, settings_logs, proxies,
                pricewatch, datasources, discovery):
    app.include_router(_module.router)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")
