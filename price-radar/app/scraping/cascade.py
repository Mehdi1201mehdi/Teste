"""Cascade de scraping produit, construite sur le skill web-scraping :

    requests (UA tournant, backoff)  →  Playwright + stealth (optionnel)

Chaque étape passe par le PoisonPillDetector ; si la page est bloquée
(captcha, Cloudflare, 403/429), on escalade vers la méthode suivante ou on
abandonne proprement avec un statut exploitable par les logs.
"""
import time
from dataclasses import dataclass

from ..config import settings
from .extractor import ExtractedProduct, extract_product
from .poison import PoisonPillDetector, PoisonPillType
from .polite import PoliteRequester, RequestManager, RobotsCache


@dataclass
class ScrapedProduct:
    ok: bool
    data: ExtractedProduct | None
    method: str
    status: str          # success / blocked / robots_denied / error / no_price
    error: str = ""
    duration_ms: int = 0


class RequestsProductScraper:
    def __init__(self, manager: RequestManager, detector: PoisonPillDetector):
        self.manager = manager
        self.detector = detector

    def fetch(self, url: str) -> tuple[ExtractedProduct | None, str]:
        response = self.manager.fetch(url)
        pill = self.detector.detect(url, response.text, response.status_code)
        if pill.detected and pill.type != PoisonPillType.NONE:
            return None, f"blocked:{pill.type.value}:{pill.details}"
        data = extract_product(response.text)
        return (data, "") if data.usable else (None, "no_price")


class PlaywrightProductScraper:
    """Fallback JS-heavy via un moteur navigateur furtif interchangeable
    (stealth / patchright / camoufox, cf. PLAYWRIGHT_ENGINE). Activé par
    USE_PLAYWRIGHT_FALLBACK ou par un site marqué needs_playwright."""

    def fetch(self, url: str) -> tuple[ExtractedProduct | None, str]:
        from .browser import render_html
        html = render_html(url)
        if not html:
            return None, "browser_not_installed"
        detector = PoisonPillDetector()
        pill = detector.detect(url, html, 200)
        if pill.detected and pill.type != PoisonPillType.NONE:
            return None, f"blocked:{pill.type.value}:{pill.details}"
        data = extract_product(html)
        return (data, "") if data.usable else (None, "no_price")


class ProductScrapingCascade:
    """Point d'entrée unique du scraping produit."""

    def __init__(self):
        self.polite = PoliteRequester()
        self.robots = RobotsCache()
        self.manager = RequestManager()
        self.detector = PoisonPillDetector()

    def fetch(self, url: str, min_delay: float | None = None,
              force_playwright: bool = False) -> ScrapedProduct:
        start = time.time()

        if not self.robots.can_fetch(url):
            return ScrapedProduct(False, None, "none", "robots_denied",
                                  "robots.txt interdit cette URL",
                                  int((time.time() - start) * 1000))

        self.polite.wait_for_domain(url, min_delay)

        steps: list[tuple[str, object]] = []
        if not force_playwright:
            steps.append(("requests", RequestsProductScraper(self.manager, self.detector)))
        if settings.USE_PLAYWRIGHT_FALLBACK or force_playwright:
            steps.append(("playwright", PlaywrightProductScraper()))

        last_error = ""
        for method, scraper in steps:
            try:
                data, error = scraper.fetch(url)  # type: ignore[attr-defined]
            except Exception as exc:  # réseau, timeout…
                last_error = f"{type(exc).__name__}: {exc}"
                continue
            duration = int((time.time() - start) * 1000)
            if data is not None:
                return ScrapedProduct(True, data, method, "success", "", duration)
            last_error = error
            # Si bloqué, on tente la méthode suivante ; sinon (no_price) aussi,
            # car un rendu JS peut faire apparaître le prix.

        duration = int((time.time() - start) * 1000)
        status = "blocked" if last_error.startswith("blocked") else \
                 "no_price" if last_error == "no_price" else "error"
        return ScrapedProduct(False, None, "none", status, last_error, duration)

    def fetch_raw(self, url: str, min_delay: float | None = None,
                  force_playwright: bool = False) -> tuple[str | None, str]:
        """Récupère le HTML brut d'une page (listing, recherche, catégorie).
        Utilisé par la découverte de produits, pas par l'extraction produit."""
        if not self.robots.can_fetch(url):
            return None, "robots_denied"
        self.polite.wait_for_domain(url, min_delay)

        # Rendu JavaScript si le site l'exige (moteur navigateur furtif)
        if force_playwright or settings.USE_PLAYWRIGHT_FALLBACK:
            from .browser import render_html
            html = render_html(url)
            if html:
                pill = self.detector.detect(url, html, 200)
                if not (pill.detected and pill.type != PoisonPillType.NONE):
                    return html, "success"

        try:
            response = self.manager.fetch(url)
        except Exception as exc:
            return None, f"error:{type(exc).__name__}"
        pill = self.detector.detect(url, response.text, response.status_code)
        if pill.detected and pill.type != PoisonPillType.NONE:
            return None, f"blocked:{pill.type.value}"
        return response.text, "success"


# Instance partagée (les délais par domaine doivent être globaux au process)
cascade = ProductScrapingCascade()
