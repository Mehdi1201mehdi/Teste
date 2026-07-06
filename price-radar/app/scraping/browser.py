"""Rendu de page via un moteur navigateur furtif, interchangeable.

Choix du moteur par `PLAYWRIGHT_ENGINE` (.env) :
  - "scrapling" : Scrapling StealthyFetcher (Camoufox furtif piloté,
                  adaptatif, orienté performance)                [défaut]
  - "stealth"   : Playwright (Chromium) + playwright-stealth
  - "patchright": Patchright (Playwright patché anti-détection, drop-in)
  - "camoufox"  : Camoufox (Firefox furtif, fingerprint au niveau C++)
  - "plain"     : Playwright sans furtivité

Chaque moteur est importé de façon paresseuse et tolérante : s'il n'est pas
installé, on renvoie None (repli géré par la cascade) au lieu de planter.
Pour activer Scrapling, installe ses navigateurs une fois : `scrapling install`.

⚠️ La furtivité réduit la détection ; elle ne « bat » pas à elle seule les
protections agressives (DataDome, Cloudflare Turnstile) qui vérifient aussi
la réputation d'IP → à combiner avec des proxies résidentiels. Aucun de ces
moteurs ne résout de CAPTCHA.
"""
import logging

from ..config import settings

logger = logging.getLogger("price-radar.browser")

USER_AGENT = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")


def _render_playwright(url: str, wait_ms: int, stealth: bool) -> str | None:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return None
    stealth_fn = None
    if stealth:
        try:
            from playwright_stealth import stealth_sync
            stealth_fn = stealth_sync
        except ImportError:
            logger.info("playwright-stealth non installé : Chromium simple")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_context(user_agent=USER_AGENT, locale="fr-FR").new_page()
        if stealth_fn:
            stealth_fn(page)
        page.goto(url, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(wait_ms)
        html = page.content()
        browser.close()
        return html


def _render_patchright(url: str, wait_ms: int) -> str | None:
    try:
        from patchright.sync_api import sync_playwright
    except ImportError:
        return None
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_context(user_agent=USER_AGENT, locale="fr-FR").new_page()
        page.goto(url, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(wait_ms)
        html = page.content()
        browser.close()
        return html


def _render_camoufox(url: str, wait_ms: int) -> str | None:
    try:
        from camoufox.sync_api import Camoufox
    except ImportError:
        return None
    with Camoufox(headless=True, locale="fr-FR") as browser:
        page = browser.new_page()
        page.goto(url, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(wait_ms)
        html = page.content()
        return html


def _render_scrapling(url: str, wait_ms: int) -> str | None:
    """Scrapling StealthyFetcher : Camoufox furtif piloté, adaptatif.

    Nécessite `scrapling install` (navigateurs). Furtivité uniquement :
    on laisse `solve_cloudflare=False` — on ne force aucun challenge
    anti-bot / CAPTCHA (choix assumé, cf. en-tête du module)."""
    try:
        from scrapling.fetchers import StealthyFetcher
    except ImportError:
        return None
    try:
        resp = StealthyFetcher.fetch(
            url, headless=True, network_idle=True, wait=wait_ms,
            timeout=60000, solve_cloudflare=False)
    except Exception as exc:            # navigateurs non installés, timeout…
        logger.info("Scrapling indisponible (%s) : lancer `scrapling install`", exc)
        return None
    if not resp or (resp.status and resp.status >= 400):
        return None
    return resp.html_content or None


# Moteurs disponibles : nom -> fonction de rendu
def _engines():
    return {
        "scrapling": _render_scrapling,
        "stealth": lambda url, w: _render_playwright(url, w, stealth=True),
        "plain": lambda url, w: _render_playwright(url, w, stealth=False),
        "patchright": _render_patchright,
        "camoufox": _render_camoufox,
    }


def render_html(url: str, wait_ms: int | None = None) -> str | None:
    """Rend l'URL via le moteur configuré ; repli sur Playwright stealth si le
    moteur choisi est absent, puis None si aucun n'est disponible."""
    wait_ms = settings.BROWSER_WAIT_MS if wait_ms is None else wait_ms
    engines = _engines()
    engine = settings.PLAYWRIGHT_ENGINE if settings.PLAYWRIGHT_ENGINE in engines else "stealth"

    order = [engine] + [e for e in ("scrapling", "stealth", "plain") if e != engine]
    for name in order:
        try:
            html = engines[name](url, wait_ms)
        except Exception as exc:
            logger.warning("Moteur %s a échoué sur %s : %s", name, url, exc)
            html = None
        if html:
            if name != engine:
                logger.info("Moteur %s indisponible → repli sur %s", engine, name)
            return html
    logger.warning("Aucun moteur navigateur disponible (installer playwright / "
                   "patchright / camoufox)")
    return None
