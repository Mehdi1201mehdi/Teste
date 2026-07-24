"""« Baisses du jour » : récolte les flux RSS de sites de bons plans (qui
republient légalement les grosses promos Amazon/Cdiscount/Fnac…), extrait
produit + prix + ancien prix + % de baisse, et classe par plus forte baisse.

On lit uniquement du RSS public — aucun site protégé n'est scrapé, aucun
contrôle d'accès n'est contourné, aucune clé requise. Un flux qui ne répond
pas est signalé « non disponible » et ignoré.
"""
import json
import logging
import re
from pathlib import Path

from .sitemap import fetch_rss_items

logger = logging.getLogger("price-radar.pricewatch.deals")

FEEDS_FILE = Path(__file__).resolve().parent.parent.parent / "deals_sources.json"

PRICE_RE = re.compile(r"(\d{1,4}(?:[ .]\d{3})*(?:[.,]\d{1,2})?)\s*€")
OLD_RE = re.compile(r"(?:au lieu de|anciennement|prix\s*initial|initial)\s*:?\s*"
                    r"(\d{1,4}(?:[ .]\d{3})*(?:[.,]\d{1,2})?)\s*€", re.IGNORECASE)
PCT_RE = re.compile(r"-\s*(\d{1,3})\s*%")
KNOWN_MERCHANTS = ("amazon", "cdiscount", "fnac", "darty", "boulanger",
                   "rakuten", "leclerc", "auchan", "carrefour", "manomano",
                   "leroy merlin", "castorama", "decathlon", "aliexpress")


def _price(text: str) -> float | None:
    t = text.replace(" ", "").replace(" ", "")
    if "," in t and "." in t:
        t = t.replace(".", "").replace(",", ".")
    elif "," in t:
        t = t.replace(",", ".")
    try:
        v = float(re.sub(r"[^\d.]", "", t))
        return v if v > 0 else None
    except ValueError:
        return None


def parse_deal(title: str, description: str) -> dict | None:
    """Extrait (prix, ancien prix, % baisse, marchand) d'un item de bon plan."""
    text = f"{title} {description}"
    old_m = OLD_RE.search(text)
    old_price = _price(old_m.group(1)) if old_m else None
    pct_m = PCT_RE.search(text)
    discount = float(pct_m.group(1)) if pct_m else None

    prices = [p for p in (_price(x) for x in PRICE_RE.findall(text)) if p]
    current = None
    if prices:
        cands = [p for p in prices if p != old_price] or prices
        current = min(cands)     # le prix promo est le plus bas cité

    if old_price and current and old_price > current and discount is None:
        discount = round((old_price - current) / old_price * 100, 1)

    merchant = ""
    low = text.lower()
    for m in KNOWN_MERCHANTS:
        if m in low:
            merchant = m.title()
            break

    if current is None and discount is None:
        return None
    return {"price": current, "old_price": old_price,
            "discount_percent": discount, "merchant": merchant}


def load_feeds() -> list[dict]:
    try:
        data = json.loads(FEEDS_FILE.read_text(encoding="utf-8"))
        return [f for f in data.get("feeds", []) if f.get("url")]
    except (OSError, json.JSONDecodeError):
        return []


def _dig(obj, path: str):
    """Navigue dans un JSON via un chemin pointé, ex 'data.deals.0.price'."""
    if not path:
        return obj
    cur = obj
    for part in path.split("."):
        if isinstance(cur, list):
            try:
                cur = cur[int(part)]
            except (ValueError, IndexError):
                return None
        elif isinstance(cur, dict):
            cur = cur.get(part)
        else:
            return None
        if cur is None:
            return None
    return cur


def harvest_json_feed(feed: dict) -> tuple[list[dict], str]:
    """Lit une API JSON (issue de la rétro-ingénierie d'un site de deals) et
    la normalise via le mapping `map` déclaré dans deals_sources.json."""
    from .sitemap import _get
    body, status = _get(feed["url"])
    if body is None:
        return [], status
    try:
        data = json.loads(body)
    except (json.JSONDecodeError, TypeError):
        return [], "parse_error"

    m = feed.get("map", {})
    items = _dig(data, m.get("items", ""))
    if items is None:
        items = data if isinstance(data, list) else []
    out = []
    for it in items:
        price = _price(str(_dig(it, m.get("price", "")) or ""))
        old = _price(str(_dig(it, m.get("old_price", "")) or ""))
        disc_raw = _dig(it, m.get("discount", ""))
        try:
            discount = float(disc_raw) if disc_raw not in (None, "") else None
        except (TypeError, ValueError):
            discount = None
        if old and price and old > price and discount is None:
            discount = round((old - price) / old * 100, 1)
        out.append({
            "name": str(_dig(it, m.get("title", "")) or "").strip(),
            "url": str(_dig(it, m.get("url", "")) or ""),
            "merchant": str(_dig(it, m.get("merchant", "")) or ""),
            "price": price, "old_price": old, "discount_percent": discount,
        })
    return out, "ok"


def _harvest_rss_feed(feed: dict, limit: int) -> tuple[list[dict], str]:
    items, status = fetch_rss_items(feed["url"], limit)
    if status != "ok":
        return [], status
    out = []
    for it in items:
        parsed = parse_deal(it.get("title", ""), it.get("description", ""))
        if not parsed:
            continue
        out.append({"name": it.get("title", "").strip(),
                    "url": it.get("link", ""), "merchant": parsed["merchant"],
                    "price": parsed["price"], "old_price": parsed["old_price"],
                    "discount_percent": parsed["discount_percent"]})
    return out, "ok"


def harvest(min_discount: float = 20, limit_per_feed: int = 100,
            merchant_filter: str = "") -> dict:
    """Récolte tous les flux actifs (RSS ou JSON) et classe les baisses."""
    deals: list[dict] = []
    per_feed: list[dict] = []
    for feed in load_feeds():
        if not feed.get("enabled", True):
            continue
        if feed.get("type") == "json":
            items, status = harvest_json_feed(feed)
        else:
            items, status = _harvest_rss_feed(feed, limit_per_feed)
        if status != "ok":
            per_feed.append({"feed": feed["name"], "status": "non_disponible",
                            "found": 0})
            continue
        n = 0
        for d in items:
            pct = d.get("discount_percent")
            if pct is None or pct < min_discount:
                continue
            if merchant_filter and merchant_filter.lower() not in \
                    (d.get("merchant") or "").lower():
                continue
            deals.append({**d, "feed": feed["name"]})
            n += 1
        per_feed.append({"feed": feed["name"], "status": "ok", "found": n})

    deals.sort(key=lambda d: d["discount_percent"] or 0, reverse=True)
    return {"count": len(deals), "deals": deals, "per_feed": per_feed}
