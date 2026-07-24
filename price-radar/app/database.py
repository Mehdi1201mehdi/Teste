from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

from .config import settings

connect_args = {"check_same_thread": False} if settings.DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(settings.DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def run_light_migrations():
    """Ajoute les colonnes manquantes sur les bases déjà existantes (SQLite),
    pour ne pas forcer l'utilisateur à supprimer price_radar.db."""
    from sqlalchemy import inspect, text

    inspector = inspect(engine)
    tables = inspector.get_table_names()
    if "websites" not in tables:
        return  # tables pas encore créées ; create_all s'en charge
    cols = {c["name"] for c in inspector.get_columns("websites")}
    with engine.begin() as conn:
        if "search_url_template" not in cols:
            conn.execute(text(
                "ALTER TABLE websites ADD COLUMN search_url_template "
                "VARCHAR DEFAULT ''"))
    if "proxy_sources" in tables:
        pcols = {c["name"] for c in inspector.get_columns("proxy_sources")}
        with engine.begin() as conn:
            if "format" not in pcols:
                conn.execute(text(
                    "ALTER TABLE proxy_sources ADD COLUMN format "
                    "VARCHAR DEFAULT 'text'"))
