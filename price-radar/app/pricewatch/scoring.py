"""Calculs de la Veille prix : baisse €/%, prix suspect, règles de détection,
score d'opportunité, classification d'alerte."""


def compute_discount(old_price: float | None,
                     current_price: float | None) -> tuple[float | None, float | None]:
    """(baisse_en_euros, baisse_en_pourcentage) à partir d'un prix barré."""
    if not old_price or not current_price or old_price <= 0:
        return None, None
    if current_price >= old_price:
        return 0.0, 0.0
    amount = round(old_price - current_price, 2)
    percent = round(amount / old_price * 100, 1)
    return amount, percent


def is_suspicious(old_price: float | None, current_price: float | None,
                  discount_percent: float | None, cfg: dict) -> bool:
    """Prix aberrant / erreur évidente à ignorer."""
    if current_price is None or current_price <= 0:
        return True
    if current_price < cfg["suspiciousMinPrice"]:
        return True
    if discount_percent is not None and \
            discount_percent >= cfg["suspiciousMaxDiscountPercent"]:
        return True  # -97% = quasi-certainement une erreur/donnée cassée
    return False


def passes_rules(discount_percent: float | None, discount_amount: float | None,
                 available: bool, suspicious: bool, cfg: dict) -> bool:
    if suspicious or discount_percent is None or discount_amount is None:
        return False
    if discount_percent < cfg["minDiscountPercent"]:
        return False
    if discount_amount < cfg["minDiscountAmount"]:
        return False
    if cfg["ignoreOutOfStock"] and not available:
        return False
    return True


def opportunity_score(discount_percent: float, discount_amount: float,
                      available: bool, source_trusted: bool, has_ean: bool,
                      history_count: int) -> int:
    """Score 0-100 combinant % baisse, montant, dispo, fiabilité source,
    présence EAN/SKU, historique (proxy de fiabilité du prix de référence)."""
    score = 0
    if discount_percent >= 50:
        score += 45
    elif discount_percent >= 30:
        score += 35
    elif discount_percent >= 20:
        score += 25
    elif discount_percent > 0:
        score += int(discount_percent / 2)

    if discount_amount >= 100:
        score += 15
    elif discount_amount >= 50:
        score += 10
    elif discount_amount >= 10:
        score += 5

    if available:
        score += 10
    if source_trusted:
        score += 10
    if has_ean:
        score += 5
    if history_count >= 3:
        score += 5  # prix de référence corroboré par l'historique
    return max(0, min(100, score))


def classify_alert(discount_percent: float | None, cfg: dict) -> str | None:
    """None / 'baisse' / 'baisse-forte' (>=alert) / 'baisse-urgente' (>=urgent)."""
    if discount_percent is None:
        return None
    if discount_percent >= cfg["urgentPercent"]:
        return "baisse-urgente"
    if discount_percent >= cfg["alertPercent"]:
        return "baisse-forte"
    if discount_percent >= cfg["minDiscountPercent"]:
        return "baisse"
    return None


def advice(level: str | None) -> str:
    return {
        "baisse-urgente": "Vérifier le stock puis ajuster le prix commerce en priorité.",
        "baisse-forte": "Vérifier stock puis ajuster prix commerce.",
        "baisse": "Surveiller, opportunité modérée.",
    }.get(level or "", "Pas d'action.")
