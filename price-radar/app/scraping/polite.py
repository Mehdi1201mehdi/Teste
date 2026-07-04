"""Requêtes HTTP polies : délais par domaine, rotation d'UA, backoff,
respect de robots.txt. Repris du skill web-scraping (PoliteRequester /
RequestManager)."""
import random
import time
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

import requests

from ..config import settings

try:
    from curl_cffi import requests as cffi_requests
    _HAS_CURL_CFFI = True
except ImportError:
    _HAS_CURL_CFFI = False

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) "
    "Gecko/20100101 Firefox/126.0",
]


class PoliteRequester:
    """Un délai aléatoire (avec jitter) entre deux requêtes vers un même
    domaine, pour ne jamais surcharger les sites cibles."""

    def __init__(self, min_delay: float | None = None, max_delay: float | None = None):
        self.min_delay = min_delay or settings.SCRAPE_MIN_DELAY
        self.max_delay = max_delay or settings.SCRAPE_MAX_DELAY
        self.last_request_per_domain: dict[str, float] = {}

    def wait_for_domain(self, url: str, min_delay_override: float | None = None):
        domain = urlparse(url).netloc
        last_request = self.last_request_per_domain.get(domain, 0)
        lo = max(self.min_delay, min_delay_override or 0)
        delay = random.uniform(lo, max(lo, self.max_delay))
        elapsed = time.time() - last_request
        if elapsed < delay:
            time.sleep(delay - elapsed)
        self.last_request_per_domain[domain] = time.time()


class RobotsCache:
    """Vérifie robots.txt (mis en cache par domaine)."""

    def __init__(self):
        self._cache: dict[str, RobotFileParser | None] = {}

    def can_fetch(self, url: str, user_agent: str = "*") -> bool:
        if not settings.RESPECT_ROBOTS_TXT:
            return True
        domain = urlparse(url).netloc
        if domain not in self._cache:
            rp = RobotFileParser()
            rp.set_url(f"{urlparse(url).scheme}://{domain}/robots.txt")
            try:
                rp.read()
                self._cache[domain] = rp
            except Exception:
                self._cache[domain] = None  # robots.txt illisible → on autorise
        rp = self._cache[domain]
        return True if rp is None else rp.can_fetch(user_agent, url)


class RequestManager:
    """Session requests avec rotation d'UA, retries et backoff exponentiel."""

    def __init__(self):
        self.session = requests.Session()
        # curl_cffi : furtivité au niveau TLS (empreinte JA3 d'un navigateur)
        self.use_cffi = settings.USE_CURL_CFFI and _HAS_CURL_CFFI
        if settings.SCRAPE_PROXY:
            self.session.proxies = {
                "http": settings.SCRAPE_PROXY,
                "https": settings.SCRAPE_PROXY,
            }

    def _pick_proxy(self) -> dict | None:
        """Proxy statique (.env) prioritaire ; sinon un proxy vivant du pool
        si PROXY_POOL_ENABLED. Import tardif pour éviter les cycles."""
        if settings.SCRAPE_PROXY:
            return None  # déjà appliqué à la session
        if not settings.PROXY_POOL_ENABLED:
            return None
        try:
            from ..proxies import get_working_proxy
            return get_working_proxy()
        except Exception:
            return None

    def get_headers(self) -> dict:
        return {
            "User-Agent": random.choice(USER_AGENTS),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
            "Accept-Encoding": "gzip, deflate, br",
            "DNT": "1",
            "Connection": "keep-alive",
            "Upgrade-Insecure-Requests": "1",
        }

    def fetch(self, url: str, retry_count: int | None = None) -> requests.Response:
        retries = retry_count or settings.SCRAPE_RETRIES
        last_exc: Exception | None = None
        for attempt in range(retries):
            try:
                # Un proxy vivant est tiré du pool à chaque tentative (rotation)
                proxy = self._pick_proxy()
                if self.use_cffi:
                    # Imite l'empreinte TLS/JA3 d'un vrai Chrome
                    response = cffi_requests.get(
                        url, headers=self.get_headers(),
                        timeout=settings.SCRAPE_TIMEOUT,
                        proxies=proxy or (self.session.proxies or None),
                        impersonate=settings.CURL_CFFI_IMPERSONATE,
                    )
                else:
                    response = self.session.get(
                        url, headers=self.get_headers(),
                        timeout=settings.SCRAPE_TIMEOUT, proxies=proxy
                    )
                # 429/403 : on backoff sans lever tout de suite, le poison
                # pill detector décidera quoi faire du contenu
                if response.status_code in (403, 429) and attempt < retries - 1:
                    time.sleep(2 ** (attempt + 1))
                    continue
                return response
            except Exception as exc:  # requests.* ou curl_cffi.*
                last_exc = exc
                if attempt < retries - 1:
                    time.sleep(2 ** attempt)  # backoff exponentiel
        raise last_exc  # type: ignore[misc]
