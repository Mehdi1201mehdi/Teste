"""Pool de proxies publics gratuits.

Pipeline :
    fetch (sources actives)  →  parse + détection protocole  →  fusion + dédup
    →  test concurrent  →  scoring  →  persistance BDD  →  purge des morts

Les proxies vivants alimentent le scraping (rotation) si PROXY_POOL_ENABLED.
Les sources sont configurables dans proxy_sources.json OU depuis le panneau
admin (page Proxies), qui écrit dans la table proxy_sources.
"""
import json
import logging
import random
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

import requests
from sqlalchemy.orm import Session

from .. import models
from ..config import settings
from ..database import SessionLocal

logger = logging.getLogger("price-radar.proxies")

SOURCES_FILE = Path(__file__).resolve().parent.parent.parent / "proxy_sources.json"

# host:port éventuellement précédé d'un schéma (http://, socks5://…)
PROXY_RE = re.compile(
    r"(?:(?P<scheme>https?|socks4a?|socks5)://)?"
    r"(?P<host>(?:\d{1,3}\.){3}\d{1,3})[:\s]+(?P<port>\d{2,5})"
)


# --------------------------------------------------------------- initialisation
def load_default_sources() -> list[dict]:
    if not SOURCES_FILE.exists():
        return []
    try:
        data = json.loads(SOURCES_FILE.read_text())
        return [s for s in data.get("sources", []) if isinstance(s, dict) and s.get("url")]
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("proxy_sources.json illisible : %s", exc)
        return []


def ensure_sources_seeded(db: Session):
    """Au premier démarrage, remplit proxy_sources depuis le fichier JSON."""
    if db.query(models.ProxySource).count():
        return
    for s in load_default_sources():
        db.add(models.ProxySource(
            name=s["name"], url=s["url"],
            protocol=s.get("protocol", "http"),
            enabled=s.get("enabled", True),
        ))
    db.commit()
    logger.info("Sources de proxies initialisées depuis proxy_sources.json")


# ------------------------------------------------------------------- détection
def detect_protocol(scheme: str | None, source_protocol: str) -> str:
    """Le protocole vient du schéma explicite dans la ligne, sinon de la
    source déclarante (fichier/BDD)."""
    if scheme:
        scheme = scheme.lower()
        if scheme.startswith("socks5"):
            return "socks5"
        if scheme.startswith("socks4"):
            return "socks4"
        if scheme in ("http", "https"):
            return scheme
    return source_protocol if source_protocol in \
        ("http", "https", "socks4", "socks5") else "http"


def parse_proxy_list(text: str, source_protocol: str) -> list[tuple[str, str, int]]:
    """Retourne [(protocol, host, port)] pour chaque ligne valide."""
    out = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = PROXY_RE.search(line)
        if not m:
            continue
        port = int(m.group("port"))
        if not (0 < port < 65536):
            continue
        protocol = detect_protocol(m.group("scheme"), source_protocol)
        out.append((protocol, m.group("host"), port))
    return out


# ------------------------------------------------------------------- test/score
def test_proxy(protocol: str, host: str, port: int) -> tuple[bool, int | None]:
    """Teste un proxy sur PROXY_TEST_URL. Retourne (vivant, latence_ms)."""
    proxy_url = f"{protocol}://{host}:{port}"
    proxies = {"http": proxy_url, "https": proxy_url}
    start = time.time()
    try:
        resp = requests.get(settings.PROXY_TEST_URL, proxies=proxies,
                            timeout=settings.PROXY_TEST_TIMEOUT,
                            headers={"User-Agent": "Mozilla/5.0"})
        if resp.status_code == 200:
            return True, int((time.time() - start) * 1000)
    except Exception:
        pass
    return False, None


def score_from_latency(latency_ms: int, success: int, fail: int) -> int:
    """Score 0-100 : latence faible = meilleur, bonifié par l'historique."""
    base = max(1, 100 - latency_ms // 50)          # 0 ms→100, 5000 ms→~1
    reliability = success / (success + fail) if (success + fail) else 1
    return max(1, min(100, int(base * (0.6 + 0.4 * reliability))))


# ------------------------------------------------------------------- manager
class ProxyManager:
    def __init__(self):
        self.test_url = settings.PROXY_TEST_URL

    def fetch_source(self, source: models.ProxySource) -> list[tuple[str, str, int]]:
        try:
            resp = requests.get(source.url, timeout=settings.PROXY_FETCH_TIMEOUT,
                                headers={"User-Agent": "price-radar/1.0"})
            resp.raise_for_status()
            proxies = parse_proxy_list(resp.text, source.protocol)
            source.last_fetched_at = datetime.utcnow()
            source.last_count = len(proxies)
            source.last_error = ""
            return proxies
        except Exception as exc:
            source.last_error = f"{type(exc).__name__}: {exc}"[:300]
            source.last_fetched_at = datetime.utcnow()
            source.last_count = 0
            logger.warning("Source %s en échec : %s", source.name, exc)
            return []

    def collect(self, db: Session) -> dict[str, tuple[str, str, int]]:
        """Télécharge toutes les sources actives, fusionne et déduplique.
        Clé de dédup : protocol://host:port."""
        sources = db.query(models.ProxySource).filter(
            models.ProxySource.enabled.is_(True)).all()
        merged: dict[str, tuple[str, str, int]] = {}
        for source in sources:
            for protocol, host, port in self.fetch_source(source):
                key = f"{protocol}://{host}:{port}"
                if key not in merged:
                    merged[key] = (protocol, host, port)
        db.commit()
        return merged

    def refresh(self) -> dict:
        """Cycle complet. Renvoie un résumé chiffré."""
        db = SessionLocal()
        try:
            ensure_sources_seeded(db)
            merged = self.collect(db)
            logger.info("Proxies collectés (uniques) : %d", len(merged))

            # On limite le nombre testé par cycle (les listes font des milliers
            # d'entrées) — priorité aux nouveaux + à ceux déjà vivants.
            candidates = list(merged.items())
            random.shuffle(candidates)
            candidates = candidates[: settings.PROXY_TEST_LIMIT]

            existing = {p.key: p for p in db.query(models.Proxy).all()}
            alive_count = 0

            with ThreadPoolExecutor(max_workers=settings.PROXY_TEST_WORKERS) as pool:
                futures = {
                    pool.submit(test_proxy, proto, host, port): (key, proto, host, port)
                    for key, (proto, host, port) in candidates
                }
                for future in as_completed(futures):
                    key, proto, host, port = futures[future]
                    alive, latency = future.result()
                    proxy = existing.get(key)
                    if proxy is None:
                        proxy = models.Proxy(key=key, protocol=proto, host=host,
                                             port=port, success_count=0,
                                             fail_count=0, score=0)
                        db.add(proxy)
                        existing[key] = proxy
                    proxy.last_checked_at = datetime.utcnow()
                    if alive:
                        alive_count += 1
                        proxy.alive = True
                        proxy.latency_ms = latency
                        proxy.success_count = (proxy.success_count or 0) + 1
                        proxy.fail_count = 0
                        proxy.score = score_from_latency(
                            latency, proxy.success_count, proxy.fail_count)
                    else:
                        proxy.alive = False
                        proxy.fail_count = (proxy.fail_count or 0) + 1
                        proxy.score = 0
                db.commit()

            # Purge des proxies morts au-delà du seuil d'échecs
            purged = db.query(models.Proxy).filter(
                models.Proxy.fail_count >= settings.PROXY_MAX_FAILS
            ).delete(synchronize_session=False)
            db.commit()

            total = db.query(models.Proxy).count()
            alive_total = db.query(models.Proxy).filter(
                models.Proxy.alive.is_(True)).count()
            summary = {
                "collected_unique": len(merged),
                "tested": len(candidates),
                "alive_this_cycle": alive_count,
                "purged_dead": purged,
                "total_in_db": total,
                "alive_in_db": alive_total,
            }
            logger.info("Refresh proxies : %s", summary)
            return summary
        finally:
            db.close()


# ------------------------------------------------------ sélection pour scraping
def get_working_proxy() -> dict | None:
    """Retourne {'http': url, 'https': url} d'un proxy vivant bien noté,
    ou None. Utilisé par le scraping si PROXY_POOL_ENABLED."""
    if not settings.PROXY_POOL_ENABLED:
        return None
    db = SessionLocal()
    try:
        top = (db.query(models.Proxy)
               .filter(models.Proxy.alive.is_(True))
               .order_by(models.Proxy.score.desc())
               .limit(20).all())
        if not top:
            return None
        proxy = random.choice(top)  # rotation parmi les 20 meilleurs
        return {"http": proxy.url, "https": proxy.url}
    finally:
        db.close()
