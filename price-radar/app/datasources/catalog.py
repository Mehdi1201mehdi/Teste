"""Chargement du catalogue de sources (sources.config.json) et fusion avec
l'état stocké en base (activation) + statut de configuration des clés."""
import json
import logging
import os
from functools import lru_cache
from pathlib import Path

logger = logging.getLogger("price-radar.datasources.catalog")

CONFIG_FILE = Path(__file__).resolve().parent.parent.parent / "sources.config.json"


@lru_cache(maxsize=1)
def _raw() -> dict:
    try:
        return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        logger.error("sources.config.json illisible : %s", exc)
        return {"categories": {}, "sources": []}


def load_catalog() -> dict:
    return _raw()


def categories() -> dict:
    return _raw().get("categories", {})


def _key_configured(env_key: str, db=None) -> bool:
    if not env_key:
        return True  # pas de clé nécessaire
    if os.getenv(env_key):
        return True
    if db is not None:
        from ..services.alerts import get_setting
        return bool(get_setting(db, f"apikey:{env_key}", ""))
    return False


def get_source(source_id: str) -> dict | None:
    for s in _raw().get("sources", []):
        if s.get("id") == source_id:
            return s
    return None


def list_sources(db=None, category: str | None = None,
                 search: str = "") -> list[dict]:
    """Sources enrichies de : configured (clé présente, jamais la valeur),
    enabled (état BDD), has_test."""
    enabled_map = {}
    if db is not None:
        from .. import models
        for st in db.query(models.ApiSourceState).all():
            enabled_map[st.source_id] = st.enabled

    out = []
    for s in _raw().get("sources", []):
        if category and s.get("category") != category:
            continue
        if search:
            hay = f"{s.get('name','')} {s.get('id','')} {s.get('category','')}".lower()
            if search.lower() not in hay:
                continue
        out.append({
            "id": s["id"], "name": s["name"], "category": s["category"],
            "freeType": s["freeType"], "authType": s.get("authType", "none"),
            "envKey": s.get("envKey", ""), "docs": s.get("docs", ""),
            "rateLimit": s.get("rateLimit", ""), "kind": s.get("kind", "api"),
            "baseUrl": s.get("baseUrl", ""),
            "has_test": bool(s.get("test")),
            "alternative": s.get("alternative", ""),
            "configured": _key_configured(s.get("envKey", ""), db),
            "enabled": enabled_map.get(s["id"], True),
        })
    return out
