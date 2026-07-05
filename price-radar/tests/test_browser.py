"""Tests du moteur navigateur furtif interchangeable (sans lancer de vrai
navigateur : on vérifie la logique de sélection et le repli)."""
import app.scraping.browser as browser
from app.config import settings


def test_engine_map_complete():
    engines = browser._engines()
    assert set(engines) == {"stealth", "plain", "patchright", "camoufox"}


def test_selected_engine_is_called(monkeypatch):
    calls = []
    fake = {name: (lambda url, w, n=name: calls.append(n) or "<html>ok</html>")
            for name in ("stealth", "plain", "patchright", "camoufox")}
    monkeypatch.setattr(browser, "_engines", lambda: fake)
    monkeypatch.setattr(settings, "PLAYWRIGHT_ENGINE", "camoufox")
    html = browser.render_html("https://x", wait_ms=0)
    assert html == "<html>ok</html>"
    assert calls[0] == "camoufox"        # le moteur choisi est essayé en 1er


def test_fallback_when_engine_missing(monkeypatch):
    # camoufox indisponible (renvoie None) -> repli sur stealth
    def eng(name):
        if name == "camoufox":
            return lambda url, w: None
        return lambda url, w: "<html>fallback</html>"
    monkeypatch.setattr(browser, "_engines",
                        lambda: {n: eng(n) for n in
                                 ("stealth", "plain", "patchright", "camoufox")})
    monkeypatch.setattr(settings, "PLAYWRIGHT_ENGINE", "camoufox")
    assert browser.render_html("https://x", wait_ms=0) == "<html>fallback</html>"


def test_returns_none_when_nothing_installed(monkeypatch):
    monkeypatch.setattr(browser, "_engines",
                        lambda: {n: (lambda url, w: None) for n in
                                 ("stealth", "plain", "patchright", "camoufox")})
    monkeypatch.setattr(settings, "PLAYWRIGHT_ENGINE", "stealth")
    assert browser.render_html("https://x", wait_ms=0) is None


def test_unknown_engine_defaults_to_stealth(monkeypatch):
    calls = []
    monkeypatch.setattr(browser, "_engines",
                        lambda: {n: (lambda url, w, n=n: calls.append(n) or "<h/>")
                                 for n in ("stealth", "plain", "patchright", "camoufox")})
    monkeypatch.setattr(settings, "PLAYWRIGHT_ENGINE", "n_importe_quoi")
    browser.render_html("https://x", wait_ms=0)
    assert calls[0] == "stealth"
