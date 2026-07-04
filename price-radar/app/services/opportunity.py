"""Détection d'erreurs de prix : prix moyen du marché, score d'opportunité,
marge estimée, niveau de risque."""
from dataclasses import dataclass
from statistics import mean

from sqlalchemy.orm import Session

from .. import models


@dataclass
class OpportunityResult:
    market_price: float | None
    gap_eur: float | None
    gap_percent: float | None
    margin_eur: float | None
    margin_percent: float | None
    score: int
    level: str      # faible / moyen / fort / exceptionnel
    risk: str       # faible / moyen / eleve


def compute_market_price(db: Session, product: models.Product,
                         current_price: float) -> float | None:
    """Prix moyen du marché, par ordre de préférence :
    1. valeur saisie manuellement (market_price_auto = False)
    2. moyenne des derniers prix des produits partageant le même EAN
       (concurrents suivis dans l'outil)
    3. moyenne de l'historique du produit lui-même (30 derniers relevés),
       ancien prix barré inclus
    """
    if product.market_price and not product.market_price_auto:
        return product.market_price

    prices: list[float] = []

    if product.ean:
        rows = (
            db.query(models.Product)
            .filter(models.Product.ean == product.ean,
                    models.Product.id != product.id,
                    models.Product.last_price.isnot(None))
            .all()
        )
        prices.extend(p.last_price for p in rows)

    history = (
        db.query(models.PriceCheck)
        .filter(models.PriceCheck.product_id == product.id)
        .order_by(models.PriceCheck.created_at.desc())
        .limit(30)
        .all()
    )
    prices.extend(c.price for c in history)
    prices.extend(c.old_price for c in history if c.old_price)
    if product.last_old_price:
        prices.append(product.last_old_price)

    # On exclut le prix courant s'il est le seul point (sinon écart = 0 trivial)
    prices = [p for p in prices if p and p > 0]
    if not prices:
        return None
    return round(mean(prices), 2)


def _history_stats(db: Session, product_id: int) -> tuple[float | None, int]:
    """(prix du relevé précédent, nombre de relevés)."""
    rows = (
        db.query(models.PriceCheck.price)
        .filter(models.PriceCheck.product_id == product_id)
        .order_by(models.PriceCheck.created_at.desc())
        .limit(30)
        .all()
    )
    previous = rows[0][0] if rows else None
    return previous, len(rows)


def evaluate(db: Session, product: models.Product, price: float,
             shipping: float | None, availability: str) -> OpportunityResult:
    market = compute_market_price(db, product, price)
    previous_price, history_count = _history_stats(db, product.id)

    if not market or market <= 0:
        return OpportunityResult(None, None, None, None, None, 0, "faible", "moyen")

    fees = shipping or 0.0
    gap_eur = round(market - price, 2)
    gap_pct = round(gap_eur / market * 100, 1)
    margin_eur = round(market - price - fees, 2)
    margin_pct = round(margin_eur / market * 100, 1) if market else None

    # --- Score 0-100 ---
    score = 0
    if gap_pct >= 70:
        score += 60
    elif gap_pct >= 50:
        score += 45
    elif gap_pct >= 30:
        score += 30
    elif gap_pct > 0:
        score += int(gap_pct / 3)

    # Baisse brutale par rapport au relevé précédent
    sudden_drop = previous_price and previous_price > 0 and \
        (previous_price - price) / previous_price >= 0.25
    if sudden_drop:
        score += 15

    if availability == "in_stock":
        score += 10
    trusted = bool(product.website and product.website.trusted)
    if trusted:
        score += 10
    if shipping is not None:  # livraison connue/possible
        score += 5
    score = max(0, min(100, score))

    # --- Niveau d'opportunité ---
    if gap_pct >= 70 or score >= 85:
        level = "exceptionnel"
    elif gap_pct >= 50:
        level = "fort"
    elif gap_pct >= 30:
        level = "moyen"
    else:
        level = "faible"

    # --- Niveau de risque ---
    # Prix « trop beau pour être vrai », vendeur inconnu ou stock douteux
    if gap_pct >= 85 or (not trusted and not product.seller) or \
            availability == "out_of_stock":
        risk = "eleve"
    elif history_count < 3 or availability == "unknown":
        risk = "moyen"  # peu de données marché
    else:
        risk = "faible"

    return OpportunityResult(market, gap_eur, gap_pct, margin_eur,
                             margin_pct, score, level, risk)
