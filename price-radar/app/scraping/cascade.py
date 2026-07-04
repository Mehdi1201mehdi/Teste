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
    """Fallback JS-heavy. Nécessite `pip install playwright playwright-stealth`
    puis `playwright install chromium`. Activé via USE_PLAYWRIGHT_FALLBACK."""

    def fetch(self, url: str) -> tuple[ExtractedProduct | None, str]:
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            return None, "playwright_not_installed"
        try:
            from playwright_stealth import stealth_sync
        except ImportError:
            stealth_sync = None

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                viewport={"width": 1920, "height": 1080},
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                           "AppleWebKit/537.36 (KHTML, like Gecko) "
                           "Chrome/124.0.0.0 Safari/537.36",
                locale="fr-FR",
            )
            page = context.new_page()
            if stealth_sync:
                stealth_sync(page)
            page.goto(url, wait_until="domcontentloaded", timeout=60000)
            page.wait_for_timeout(2500)
            html = page.content()
            browser.close()

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

        # Rendu JavaScript si le site l'exige (Playwright)
        if force_playwright or settings.USE_PLAYWRIGHT_FALLBACK:
            html = self._playwright_html(url)
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

    @staticmethod
    def _playwright_html(url: str) -> str | None:
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            return None
        try:
            from playwright_stealth import stealth_sync
        except ImportError:
            stealth_sync = None
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                page = browser.new_context(locale="fr-FR").new_page()
                if stealth_sync:
                    stealth_sync(page)
                page.goto(url, wait_until="domcontentloaded", timeout=60000)
                page.wait_for_timeout(2500)
                html = page.content()
                browser.close()
                return html
        except Exception:
            return None


# Instance partagée (les délais par domaine doivent être globaux au process)
cascade = ProductScrapingCascade()
