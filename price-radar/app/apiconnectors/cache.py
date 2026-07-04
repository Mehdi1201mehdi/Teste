"""Cache des réponses d'API : Redis si disponible/configuré, sinon cache
mémoire avec TTL. Aucune dépendance dure à Redis."""
import json
import logging
import time

from ..config import settings

logger = logging.getLogger("price-radar.apicache")

_redis = None
if settings.REDIS_URL:
    try:
        import redis  # type: ignore
        _redis = redis.from_url(settings.REDIS_URL, decode_responses=True)
        _redis.ping()
        logger.info("Cache API : Redis (%s)", settings.REDIS_URL)
    except Exception as exc:                       # redis absent ou injoignable
        logger.warning("Redis indisponible (%s) — cache mémoire", exc)
        _redis = None

# Cache mémoire : clé -> (expiration_epoch, valeur_json)
_mem: dict[str, tuple[float, str]] = {}


def get(key: str):
    if _redis is not None:
        try:
            raw = _redis.get(key)
            return json.loads(raw) if raw else None
        except Exception:
            return None
    entry = _mem.get(key)
    if not entry:
        return None
    expires, raw = entry
    if time.time() > expires:
        _mem.pop(key, None)
        return None
    return json.loads(raw)


def set(key: str, value, ttl: int):
    raw = json.dumps(value)
    if _redis is not None:
        try:
            _redis.setex(key, ttl, raw)
            return
        except Exception:
            pass
    _mem[key] = (time.time() + ttl, raw)
