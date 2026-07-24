"""Connecteur de base : logique commune à tous les modules de site.

Chaque enseigne hérite de `BaseConnector`, déclare ses attributs (domaines,
URL de recherche, particularités) et, si besoin, surcharge `parse()` ou
`extract_search_links()`. Le reste — requêtes polies, délais, reprises après
erreur, rotation de proxy, détection de blocage, journalisation — est fourni
ici et par la cascade de scraping.
"""
import logging
from dataclasses import dataclass, field
from datetime import datetime
from urllib.parse import quote_plus, urlparse

from ..scraping.cascade import cascade
from ..scraping.extractor import ExtractedProduct, extract_product
from .linkextract import extract_product_links


@dataclass
class FetchResult:
    ok: bool
    product: ExtractedProduct | None
    url: str
    connector: str
    status: str            # success / blocked / no_price / robots_denied / error / parse_error
    method: str = ""       # http / playwright
    error: str = ""
    fetched_at: datetime = field(default_factory=datetime.utcnow)


class BaseConnector:
    # --- À déclarer dans chaque sous-classe ---
    name: str = "generic"
    label: str = "Générique"
    domains: tuple[str, ...] = ()          # domaines gérés (sans www.)
    search_url_template: str = ""          # ...?q={query}
    product_url_patterns: tuple[str, ...] = ()  # segments d'URL fiche produit
    needs_playwright: bool = False         # site rendu en JavaScript
    min_delay: float = 2.0                 # délai mini entre requêtes (s)
    trusted: bool = True                   # enseigne officielle = vendeur fiable

    def __init__(self):
        self.log = logging.getLogger(f"price-radar.connector.{self.name}")

    # ------------------------------------------------------------------ parse
    def parse(self, html: str, url: str) -> ExtractedProduct:
        """Extraction par défaut (schema.org / OpenGraph / CSS). Les
        connecteurs peuvent surcharger pour gérer les particularités d'un
        site ou amortir un changement de structure."""
        return extract_product(html)

    def extract_search_links(self, html: str, search_url: str,
                             limit: int) -> list[str]:
        return extract_product_links(html, search_url,
                                     self.product_url_patterns, limit)

    # ------------------------------------------------------------------ fetch
    def fetch(self, url: str) -> FetchResult:
        """Récupère et parse une fiche produit. Gère erreurs et blocages."""
        raw, status = cascade.fetch_raw(url, self.min_delay, self.needs_playwright)
        if not raw:
            return FetchResult(False, None, url, self.name, status,
                               error=status)
        try:
            product = self.parse(raw, url)
        except Exception as exc:                     # changement de structure
            self.log.warning("Parse échoué pour %s : %s", url, exc)
            return FetchResult(False, None, url, self.name, "parse_error",
                               error=str(exc))
        if not product.usable:
            return FetchResult(False, product, url, self.name, "no_price")
        method = "playwright" if self.needs_playwright else "http"
        return FetchResult(True, product, url, self.name, "success", method)

    # ----------------------------------------------------------------- search
    def search(self, query: str, limit: int = 5) -> tuple[list[str], str]:
        """Retourne (liens produits, statut) pour un mot-clé."""
        if not self.search_url_template:
            return [], "no_search_template"
        search_url = self.search_url_template.format(query=quote_plus(query))
        raw, status = cascade.fetch_raw(search_url, self.min_delay,
                                        self.needs_playwright)
        if not raw:
            return [], status
        return self.extract_search_links(raw, search_url, limit), "success"

    # ---------------------------------------------------------------- helpers
    def handles(self, url: str) -> bool:
        netloc = urlparse(url).netloc.replace("www.", "").lower()
        return any(netloc == d or netloc.endswith("." + d) for d in self.domains)
