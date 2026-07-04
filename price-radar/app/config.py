"""Configuration centrale, chargée depuis .env."""
import os
from dotenv import load_dotenv

load_dotenv()


def _bool(key: str, default: bool) -> bool:
    return os.getenv(key, str(default)).strip().lower() in ("1", "true", "yes", "on")


def _float(key: str, default: float) -> float:
    try:
        return float(os.getenv(key, default))
    except (TypeError, ValueError):
        return default


class Settings:
    APP_HOST: str = os.getenv("APP_HOST", "0.0.0.0")
    APP_PORT: int = int(os.getenv("APP_PORT", "8000"))
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///./price_radar.db")
    SCHEDULER_ENABLED: bool = _bool("SCHEDULER_ENABLED", True)
    DEFAULT_CHECK_FREQUENCY: int = int(os.getenv("DEFAULT_CHECK_FREQUENCY", "360"))

    SCRAPE_MIN_DELAY: float = _float("SCRAPE_MIN_DELAY", 2.0)
    SCRAPE_MAX_DELAY: float = _float("SCRAPE_MAX_DELAY", 5.0)
    SCRAPE_TIMEOUT: int = int(os.getenv("SCRAPE_TIMEOUT", "30"))
    SCRAPE_RETRIES: int = int(os.getenv("SCRAPE_RETRIES", "3"))
    RESPECT_ROBOTS_TXT: bool = _bool("RESPECT_ROBOTS_TXT", True)
    USE_PLAYWRIGHT_FALLBACK: bool = _bool("USE_PLAYWRIGHT_FALLBACK", False)
    SCRAPE_PROXY: str = os.getenv("SCRAPE_PROXY", "")

    ALERT_MIN_GAP_PERCENT: float = _float("ALERT_MIN_GAP_PERCENT", 40)
    ALERT_MIN_MARGIN_EUR: float = _float("ALERT_MIN_MARGIN_EUR", 100)
    ALERT_ONLY_IN_STOCK: bool = _bool("ALERT_ONLY_IN_STOCK", True)

    SMTP_HOST: str = os.getenv("SMTP_HOST", "")
    SMTP_PORT: int = int(os.getenv("SMTP_PORT", "587"))
    SMTP_USER: str = os.getenv("SMTP_USER", "")
    SMTP_PASSWORD: str = os.getenv("SMTP_PASSWORD", "")
    SMTP_FROM: str = os.getenv("SMTP_FROM", "price-radar@example.com")
    ALERT_EMAIL_TO: str = os.getenv("ALERT_EMAIL_TO", "")

    TELEGRAM_BOT_TOKEN: str = os.getenv("TELEGRAM_BOT_TOKEN", "")
    TELEGRAM_CHAT_ID: str = os.getenv("TELEGRAM_CHAT_ID", "")
    DISCORD_WEBHOOK_URL: str = os.getenv("DISCORD_WEBHOOK_URL", "")


settings = Settings()
