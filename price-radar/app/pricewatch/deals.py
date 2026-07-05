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


def harvest(min_discount: float = 20, limit_per_feed: int = 100,
            merchant_filter: str = "") -> dict:
    """Récolte tous les flux actifs et renvoie les baisses classées."""
    deals: list[dict] = []
    per_feed: list[dict] = []
    for feed in load_feeds():
        if not feed.get("enabled", True):
            continue
        items, status = fetch_rss_items(feed["url"], limit_per_feed)
        if status != "ok":
            per_feed.append({"feed": feed["name"], "status": "non_disponible",
                            "found": 0})
            continue
        n = 0
        for it in items:
            parsed = parse_deal(it.get("title", ""), it.get("description", ""))
            if not parsed:
                continue
            if parsed["discount_percent"] is None or \
                    parsed["discount_percent"] < min_discount:
                continue
            if merchant_filter and merchant_filter.lower() not in \
                    parsed["merchant"].lower():
                continue
            deals.append({
                "name": it.get("title", "").strip(),
                "url": it.get("link", ""), "merchant": parsed["merchant"],
                "price": parsed["price"], "old_price": parsed["old_price"],
                "discount_percent": parsed["discount_percent"],
                "feed": feed["name"],
            })
            n += 1
        per_feed.append({"feed": feed["name"], "status": "ok", "found": n})

    deals.sort(key=lambda d: d["discount_percent"] or 0, reverse=True)
    return {"count": len(deals), "deals": deals, "per_feed": per_feed}
