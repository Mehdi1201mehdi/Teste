"""Sérialiseurs partagés des endpoints (Product / PriceCheck → dict)."""
from .. import models


def product_dict(p: models.Product) -> dict:
    return {
        "id": p.id, "name": p.name, "url": p.url, "image_url": p.image_url,
        "ean": p.ean, "seller": p.seller,
        "category_id": p.category_id,
        "category": p.category.name if p.category else None,
        "website_id": p.website_id,
        "website": p.website.name if p.website else None,
        "market_price": p.market_price, "market_price_auto": p.market_price_auto,
        "last_price": p.last_price, "last_old_price": p.last_old_price,
        "last_shipping": p.last_shipping, "last_availability": p.last_availability,
        "active": p.active,
        "check_frequency_minutes": p.check_frequency_minutes,
        "last_checked_at": p.last_checked_at.isoformat() if p.last_checked_at else None,
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


def check_dict(c: models.PriceCheck, with_product: bool = False) -> dict:
    data = {
        "id": c.id, "product_id": c.product_id, "price": c.price,
        "old_price": c.old_price, "shipping_cost": c.shipping_cost,
        "currency": c.currency, "availability": c.availability,
        "method": c.method, "market_price": c.market_price,
        "gap_eur": c.gap_eur, "gap_percent": c.gap_percent,
        "margin_eur": c.margin_eur, "margin_percent": c.margin_percent,
        "score": c.score, "opportunity_level": c.opportunity_level,
        "risk_level": c.risk_level,
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }
    if with_product and c.product:
        data["product"] = product_dict(c.product)
    return data
