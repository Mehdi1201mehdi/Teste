"""Envoi des alertes : dashboard (BDD), email SMTP, Telegram, Discord.
Chaque canal est optionnel et activé par ses variables d'environnement /
paramètres. Les seuils sont personnalisables (Paramètres)."""
import json
import logging
import smtplib
from email.mime.text import MIMEText

import requests
from sqlalchemy.orm import Session

from .. import models
from ..config import settings
from .opportunity import OpportunityResult

logger = logging.getLogger("price-radar.alerts")


def get_setting(db: Session, key: str, default):
    row = db.query(models.Setting).filter(models.Setting.key == key).first()
    if row is None or row.value == "":
        return default
    try:
        return json.loads(row.value)
    except (json.JSONDecodeError, TypeError):
        return row.value


def set_setting(db: Session, key: str, value):
    row = db.query(models.Setting).filter(models.Setting.key == key).first()
    encoded = json.dumps(value)
    if row is None:
        db.add(models.Setting(key=key, value=encoded))
    else:
        row.value = encoded
    db.commit()


def should_alert(db: Session, result: OpportunityResult, availability: str) -> bool:
    min_gap = float(get_setting(db, "alert_min_gap_percent",
                                settings.ALERT_MIN_GAP_PERCENT))
    min_margin = float(get_setting(db, "alert_min_margin_eur",
                                   settings.ALERT_MIN_MARGIN_EUR))
    only_in_stock = bool(get_setting(db, "alert_only_in_stock",
                                     settings.ALERT_ONLY_IN_STOCK))

    if only_in_stock and availability == "out_of_stock":
        return False
    gap_ok = result.gap_percent is not None and result.gap_percent >= min_gap
    margin_ok = result.margin_eur is not None and result.margin_eur >= min_margin
    return gap_ok or margin_ok


def _send_email(subject: str, body: str) -> bool:
    if not (settings.SMTP_HOST and settings.ALERT_EMAIL_TO):
        return False
    try:
        msg = MIMEText(body, "plain", "utf-8")
        msg["Subject"] = subject
        msg["From"] = settings.SMTP_FROM
        msg["To"] = settings.ALERT_EMAIL_TO
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as server:
            server.starttls()
            if settings.SMTP_USER:
                server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.send_message(msg)
        return True
    except Exception as exc:
        logger.warning("Envoi email échoué : %s", exc)
        return False


def _send_telegram(text: str) -> bool:
    if not (settings.TELEGRAM_BOT_TOKEN and settings.TELEGRAM_CHAT_ID):
        return False
    try:
        response = requests.post(
            f"https://api.telegram.org/bot{settings.TELEGRAM_BOT_TOKEN}/sendMessage",
            json={"chat_id": settings.TELEGRAM_CHAT_ID, "text": text,
                  "parse_mode": "HTML", "disable_web_page_preview": False},
            timeout=15,
        )
        return response.ok
    except Exception as exc:
        logger.warning("Envoi Telegram échoué : %s", exc)
        return False


def _send_discord(text: str) -> bool:
    if not settings.DISCORD_WEBHOOK_URL:
        return False
    try:
        response = requests.post(settings.DISCORD_WEBHOOK_URL,
                                 json={"content": text[:1900]}, timeout=15)
        return response.ok
    except Exception as exc:
        logger.warning("Envoi Discord échoué : %s", exc)
        return False


def create_alert(db: Session, product: models.Product,
                 check: models.PriceCheck, result: OpportunityResult) -> models.Alert:
    title = (f"🔥 {result.level.upper()} · {product.name or product.url} "
             f"à {check.price:.2f} €")
    message = (
        f"Produit : {product.name or product.url}\n"
        f"Prix trouvé : {check.price:.2f} €\n"
        f"Prix moyen du marché : {result.market_price:.2f} €\n"
        f"Écart : {result.gap_eur:.2f} € ({result.gap_percent:.1f} %)\n"
        f"Marge estimée : {result.margin_eur:.2f} €\n"
        f"Niveau : {result.level} · Risque : {result.risk} · Score : {result.score}/100\n"
        f"Site : {product.website.name if product.website else '-'}\n"
        f"Lien : {product.url}"
    )
    alert = models.Alert(
        product_id=product.id,
        price_check_id=check.id,
        title=title,
        message=message,
        level=result.level,
    )
    alert.sent_email = _send_email(title, message)
    alert.sent_telegram = _send_telegram(message)
    alert.sent_discord = _send_discord(f"**{title}**\n{message}")
    db.add(alert)
    db.commit()
    db.refresh(alert)
    return alert
