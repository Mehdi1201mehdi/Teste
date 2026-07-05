"""Connecteur d'API de base : HTTP, cache, quotas (délai mini entre appels),
journalisation et gestion d'erreurs. Chaque API officielle en hérite.

Types normalisés partagés :
- APIOffer   : une offre commerciale (prix, vendeur…) issue d'une API prix
- APIProduct : métadonnées produit (nom, marque, EAN…) issues d'une base
"""
import logging
import time
from dataclasses import asdict, dataclass, field

import requests

from ..config import settings
from . import cache


@dataclass
class APIOffer:
    source: str
    title: str = ""
    price: float | None = None
    old_price: float | None = None      # prix barré / d'origine si dispo
    discount_percent: float | None = None
    currency: str = "EUR"
    availability: str = "unknown"
    seller: str = ""
    image: str = ""
    url: str = ""
    condition: str = ""       # new / used…
    brand: str = ""
    ean: str = ""
    category: str = ""

    def dict(self) -> dict:
        return asdict(self)


@dataclass
class APIProduct:
    source: str
    ean: str = ""
    name: str = ""
    brand: str = ""
    category: str = ""
    image: str = ""
    description: str = ""
    extra: dict = field(default_factory=dict)

    def dict(self) -> dict:
        return asdict(self)


class APIConnector:
    # --- À déclarer dans chaque sous-classe ---
    name: str = "base"
    label: str = "Base"
    kind: str = "price"            # price | catalog | geo
    docs: str = ""
    required_env: tuple[str, ...] = ()   # variables .env obligatoires
    min_interval: float = 1.0            # délai mini entre 2 appels (quota)
    cache_ttl: int = 3600                # durée de cache des réponses (s)

    def __init__(self):
        self.log = logging.getLogger(f"price-radar.api.{self.name}")
        self._last_call = 0.0

    # ------------------------------------------------------------ statut/quota
    @property
    def configured(self) -> bool:
        """True si toutes les variables d'environnement requises sont là."""
        import os
        return all(os.getenv(k) for k in self.required_env)

    def _throttle(self):
        elapsed = time.time() - self._last_call
        if elapsed < self.min_interval:
            time.sleep(self.min_interval - elapsed)
        self._last_call = time.time()

    # -------------------------------------------------------------- requêtes
    def _request(self, method: str, url: str, *, params=None, headers=None,
                 data=None, json_body=None, cache_key: str | None = None,
                 timeout: int = 20) -> dict | list | None:
        """Requête HTTP avec cache (GET), quota, logs et gestion d'erreurs."""
        if cache_key:
            cached = cache.get(cache_key)
            if cached is not None:
                self.log.debug("cache hit %s", cache_key)
                return cached

        self._throttle()
        base_headers = {"User-Agent": settings.API_USER_AGENT,
                        "Accept": "application/json"}
        base_headers.update(headers or {})
        try:
            resp = requests.request(method, url, params=params,
                                    headers=base_headers, data=data,
                                    json=json_body, timeout=timeout)
        except requests.RequestException as exc:
            self.log.warning("%s %s → %s", method, url, exc)
            return None

        if resp.status_code == 429:
            self.log.warning("quota atteint (429) sur %s", self.name)
            return None
        if resp.status_code >= 400:
            self.log.warning("%s %s → HTTP %s", method, url, resp.status_code)
            return None

        try:
            payload = resp.json()
        except ValueError:
            self.log.warning("réponse non-JSON de %s", self.name)
            return None

        if cache_key and method.upper() == "GET":
            cache.set(cache_key, payload, self.cache_ttl)
        return payload

    def _get(self, url: str, **kw):
        return self._request("GET", url, **kw)

    # ------------------------------------------------------ à surcharger
    def search(self, query: str, limit: int = 10) -> list[APIOffer]:
        """Recherche par mot-clé → offres (API prix)."""
        return []

    def lookup(self, barcode: str) -> APIProduct | None:
        """Recherche par code-barres EAN/UPC → métadonnées produit."""
        return None
