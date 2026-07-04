"""Comparaison des offres agrégées depuis les API : min, max, moyenne,
économie potentielle, pourcentage de différence. Et enrichissement produit
par code-barres (EAN/UPC) depuis les bases ouvertes."""
import logging
from statistics import mean

from .. import apiconnectors as api

logger = logging.getLogger("price-radar.comparison")


def compare_offers(offers: list) -> dict:
    """offers : liste d'APIOffer (ou dicts). Calcule les statistiques."""
    dicts = [o.dict() if hasattr(o, "dict") else o for o in offers]
    priced = [o for o in dicts if o.get("price")]
    prices = [float(o["price"]) for o in priced]

    stats = {"count": len(dicts), "count_priced": len(priced)}
    if prices:
        pmin, pmax, pavg = min(prices), max(prices), round(mean(prices), 2)
        best = min(priced, key=lambda o: float(o["price"]))
        stats.update({
            "min_price": pmin, "max_price": pmax, "avg_price": pavg,
            "potential_saving": round(pmax - pmin, 2),
            "spread_percent": round((pmax - pmin) / pmax * 100, 1) if pmax else 0,
            "best_offer": best,
        })
    return {"offers": sorted(dicts,
                             key=lambda o: (o.get("price") is None,
                                            o.get("price") or 0)),
            "stats": stats}


def search_all_sources(query: str, limit_per_source: int = 8,
                       only: list[str] | None = None) -> dict:
    """Interroge toutes les sources de prix API configurées et compare."""
    offers = []
    per_source = []
    for connector in api.price_sources():
        if only and connector.name not in only:
            continue
        if not connector.configured:
            per_source.append({"source": connector.name, "label": connector.label,
                               "status": "non_configuré", "found": 0})
            continue
        try:
            found = connector.search(query, limit_per_source)
        except Exception as exc:
            logger.warning("Recherche %s échouée : %s", connector.name, exc)
            per_source.append({"source": connector.name, "label": connector.label,
                               "status": f"erreur", "found": 0})
            continue
        offers.extend(found)
        per_source.append({"source": connector.name, "label": connector.label,
                           "status": "ok", "found": len(found)})

    result = compare_offers(offers)
    result["per_source"] = per_source
    result["query"] = query
    return result


def enrich_by_barcode(barcode: str) -> dict:
    """Cherche le produit dans les bases ouvertes + récupère d'éventuelles
    offres marchandes (UPCitemDB, Barcode Lookup)."""
    products = []
    offers = []
    for connector in api.catalog_sources():
        if not connector.configured:
            continue
        try:
            product = connector.lookup(barcode)
        except Exception as exc:
            logger.warning("Lookup %s échoué : %s", connector.name, exc)
            continue
        if product:
            products.append(product.dict())
            offers.extend(product.extra.get("offers", []))

    # Fusion des métadonnées : on prend le premier champ non vide
    merged = {"ean": barcode, "name": "", "brand": "", "category": "",
              "image": "", "description": "", "sources": []}
    for p in products:
        merged["sources"].append(p["source"])
        for key in ("name", "brand", "category", "image", "description"):
            if not merged[key] and p.get(key):
                merged[key] = p[key]

    return {"barcode": barcode, "product": merged,
            "raw": products, "comparison": compare_offers(offers)}
