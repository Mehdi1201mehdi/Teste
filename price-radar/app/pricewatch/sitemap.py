"""Découverte d'URLs produits via des sources techniques PUBLIQUES et
autorisées : sitemap.xml (y compris index) et flux RSS. Respecte robots.txt
et applique des délais. Aucune protection anti-bot n'est contournée : si la
ressource est inaccessible, on renvoie une liste vide + un statut.
"""
import logging
import re
import xml.etree.ElementTree as ET

from ..scraping.polite import PoliteRequester, RequestManager, RobotsCache

logger = logging.getLogger("price-radar.pricewatch.sitemap")

LOC_RE = re.compile(r"<loc>\s*([^<\s]+)\s*</loc>", re.IGNORECASE)

_polite = PoliteRequester()
_robots = RobotsCache()
_manager = RequestManager()


def _get(url: str) -> tuple[str | None, str]:
    if not _robots.can_fetch(url):
        return None, "robots_denied"
    _polite.wait_for_domain(url)
    try:
        resp = _manager.fetch(url)
    except Exception as exc:
        return None, f"error:{type(exc).__name__}"
    if resp.status_code >= 400:
        return None, f"http_{resp.status_code}"
    return resp.text, "ok"


def fetch_sitemap_urls(sitemap_url: str, limit: int = 200,
                       url_filter: str = "", _depth: int = 0) -> tuple[list[str], str]:
    """Extrait les <loc> d'un sitemap. Suit un niveau d'index de sitemaps.
    url_filter : ne garder que les URLs contenant ce fragment (ex '/produit')."""
    body, status = _get(sitemap_url)
    if body is None:
        return [], status
    locs = LOC_RE.findall(body)
    is_index = "<sitemapindex" in body.lower()

    urls: list[str] = []
    if is_index and _depth == 0:
        # Sitemap d'index : on descend dans les sous-sitemaps (1 niveau)
        for sub in locs[:10]:
            sub_urls, _ = fetch_sitemap_urls(sub, limit, url_filter, _depth + 1)
            urls.extend(sub_urls)
            if len(urls) >= limit:
                break
    else:
        urls = locs

    if url_filter:
        urls = [u for u in urls if url_filter in u]
    return urls[:limit], "ok"


def fetch_rss_items(rss_url: str, limit: int = 100) -> tuple[list[dict], str]:
    """Items d'un flux RSS/Atom : title, link (+ description brute)."""
    body, status = _get(rss_url)
    if body is None:
        return [], status
    try:
        root = ET.fromstring(body.encode("utf-8"))
    except ET.ParseError:
        return [], "parse_error"

    items: list[dict] = []
    # RSS <item> ou Atom <entry>
    for node in root.iter():
        tag = node.tag.split("}")[-1].lower()
        if tag not in ("item", "entry"):
            continue
        title, link, desc = "", "", ""
        for child in node:
            ctag = child.tag.split("}")[-1].lower()
            if ctag == "title":
                title = (child.text or "").strip()
            elif ctag == "link":
                link = (child.get("href") or child.text or "").strip()
            elif ctag in ("description", "summary"):
                desc = (child.text or "").strip()
        if title or link:
            items.append({"title": title, "link": link, "description": desc[:300]})
        if len(items) >= limit:
            break
    return items, "ok"
