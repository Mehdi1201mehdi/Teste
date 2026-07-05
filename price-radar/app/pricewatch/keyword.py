"""Veille prix par mot-clé : tape « PC gaming », « TV », « bricolage » →
produits avec la plus forte baisse, classés par score d'opportunité.

Fusionne :
- les sources de prix API (eBay… ) → offres avec prix barré/réduction,
- la recherche multi-sites (sites accessibles, JSON-LD schema.org).

Conformité : si une source bloque ou n'est pas configurée, elle est
signalée « non disponible » et on continue. Aucun contournement anti-bot.
"""
import logging

from sqlalchemy.orm import Session

from .. import apiconnectors as api
from ..services.discovery import keyword_search
from . import scoring
from .config import get_config

logger = logging.getLogger("price-radar.pricewatch.keyword")


def _deal_from(name, price, old_price, discount_percent, source, url, image,
               availability, brand, ean, cfg) -> dict | None:
    """Construit une ligne de baisse si elle passe les règles, sinon None."""
    percent = discount_percent
    amount = None
    if old_price and price:
        amount, computed = scoring.compute_discount(old_price, price)
        percent = percent if percent is not None else computed
    if percent is None or percent <= 0:
        return None

    available = availability == "in_stock"
    suspicious = scoring.is_suspicious(old_price, price, percent, cfg)
    # Si le montant est connu, on applique la règle montant ; sinon on ne
    # bloque que sur le pourcentage.
    amount_ok = amount is None or amount >= cfg["minDiscountAmount"]
    if (suspicious or percent < cfg["minDiscountPercent"] or not amount_ok
            or (cfg["ignoreOutOfStock"] and not available)):
        return None

    trusted = source.lower() in ("ebay", "ebay (browse api)", "fnac", "darty",
                                 "boulanger", "ldlc")
    score = scoring.opportunity_score(percent, amount or 0, available,
                                      trusted, bool(ean), 0)
    level = scoring.classify_alert(percent, cfg)
    return {"name": name, "price": price, "old_price": old_price,
            "discount_amount": amount, "discount_percent": percent,
            "source": source, "url": url, "image": image,
            "availability": availability, "brand": brand, "ean": ean,
            "score": score, "level": level, "advice": scoring.advice(level)}


def keyword_deals(db: Session, query: str, max_per_source: int = 10) -> dict:
    cfg = get_config(db)
    deals: list[dict] = []
    per_source: list[dict] = []

    # 1. Sources de prix API (eBay…)
    for connector in api.price_sources():
        if not connector.configured:
            per_source.append({"source": connector.label, "status": "non_configuré",
                               "found": 0})
            continue
        try:
            offers = connector.search(query, max_per_source)
        except Exception as exc:
            logger.warning("API %s : %s", connector.name, exc)
            per_source.append({"source": connector.label, "status": "erreur", "found": 0})
            continue
        n = 0
        for o in offers:
            deal = _deal_from(o.title, o.price, o.old_price, o.discount_percent,
                              connector.label, o.url, o.image, o.availability,
                              o.brand, o.ean, cfg)
            if deal:
                deals.append(deal)
                n += 1
        per_source.append({"source": connector.label, "status": "ok", "found": n})

    # 2. Sites accessibles (scraping poli, JSON-LD) — bloqués = "non disponible"
    try:
        disc = keyword_search(db, query, None, max_per_source, add_to_monitoring=False)
        for it in disc.get("results", []):
            deal = _deal_from(it["name"], it["price"], it["old_price"],
                              it.get("discount_percent"), it["site"], it["url"],
                              it.get("image_url", ""), it["availability"],
                              it.get("brand", ""), "", cfg)
            if deal:
                deals.append(deal)
        for ps in disc.get("per_site", []):
            per_source.append({"source": ps["site"],
                               "status": "non_disponible" if ps["status"] != "success"
                               else "ok", "found": ps["found"]})
    except Exception as exc:
        logger.warning("Recherche sites : %s", exc)

    deals.sort(key=lambda d: (d["score"], d["discount_percent"] or 0), reverse=True)
    return {"query": query, "count": len(deals), "deals": deals,
            "per_source": per_source}
