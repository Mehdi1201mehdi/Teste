"""Configuration de la Veille prix : price-watch.config.json + surcharges
éventuelles stockées en base (réglables depuis l'UI)."""
import json
from pathlib import Path

CONFIG_FILE = Path(__file__).resolve().parent.parent.parent / "price-watch.config.json"

DEFAULTS = {
    "minDiscountPercent": 20,
    "minDiscountAmount": 10,
    "ignoreOutOfStock": True,
    "scanDelayMs": 3000,
    "maxProductsPerSource": 100,
    "enableAlerts": True,
    "allowedSourcesOnly": True,
    "alertPercent": 30,
    "urgentPercent": 50,
    "suspiciousMinPrice": 1.0,
    "suspiciousMaxDiscountPercent": 95,
    # Repricing (comparaison avec ton fichier Excel)
    "alignThresholdPercent": 3,    # au-delà, tu es "trop cher" -> baisser
    "raiseThresholdPercent": 10,   # en-deçà, tu es "bien moins cher" -> monter
    "undercutPercent": 1,          # de combien passer sous le concurrent
}


def _file_config() -> dict:
    try:
        data = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        return {k: data.get(k, v) for k, v in DEFAULTS.items()}
    except (OSError, json.JSONDecodeError):
        return dict(DEFAULTS)


def get_config(db=None) -> dict:
    cfg = _file_config()
    if db is not None:
        from ..services.alerts import get_setting
        override = get_setting(db, "pricewatch_config", None)
        if isinstance(override, dict):
            cfg.update({k: override[k] for k in DEFAULTS if k in override})
    return cfg


def set_config(db, values: dict) -> dict:
    from ..services.alerts import get_setting, set_setting
    current = get_setting(db, "pricewatch_config", {}) or {}
    current.update({k: values[k] for k in DEFAULTS if k in values})
    set_setting(db, "pricewatch_config", current)
    return get_config(db)
