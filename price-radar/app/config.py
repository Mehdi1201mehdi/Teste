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
    # Auto-collecte des sources API prêtes (sans intervention)
    DATASOURCE_AUTO_COLLECT: bool = _bool("DATASOURCE_AUTO_COLLECT", False)
    DATASOURCE_COLLECT_MINUTES: int = int(os.getenv("DATASOURCE_COLLECT_MINUTES", "720"))

    SCRAPE_MIN_DELAY: float = _float("SCRAPE_MIN_DELAY", 2.0)
    SCRAPE_MAX_DELAY: float = _float("SCRAPE_MAX_DELAY", 5.0)
    SCRAPE_TIMEOUT: int = int(os.getenv("SCRAPE_TIMEOUT", "30"))
    SCRAPE_RETRIES: int = int(os.getenv("SCRAPE_RETRIES", "3"))
    RESPECT_ROBOTS_TXT: bool = _bool("RESPECT_ROBOTS_TXT", True)
    USE_PLAYWRIGHT_FALLBACK: bool = _bool("USE_PLAYWRIGHT_FALLBACK", False)
    # Moteur navigateur furtif : stealth | patchright | camoufox | plain
    PLAYWRIGHT_ENGINE: str = os.getenv("PLAYWRIGHT_ENGINE", "stealth")
    BROWSER_WAIT_MS: int = int(os.getenv("BROWSER_WAIT_MS", "2500"))
    SCRAPE_PROXY: str = os.getenv("SCRAPE_PROXY", "")
    # Furtivité TLS : imite l'empreinte JA3 d'un vrai navigateur (curl_cffi).
    # Débloque les sites qui filtrent au niveau TLS, sans résoudre de CAPTCHA.
    USE_CURL_CFFI: bool = _bool("USE_CURL_CFFI", True)
    CURL_CFFI_IMPERSONATE: str = os.getenv("CURL_CFFI_IMPERSONATE", "chrome")

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

    # --- Connecteurs d'API officielles ---
    REDIS_URL: str = os.getenv("REDIS_URL", "")
    API_USER_AGENT: str = os.getenv(
        "API_USER_AGENT", "price-radar/1.0 (veille tarifaire; contact@example.com)")
    # eBay Browse API
    EBAY_CLIENT_ID: str = os.getenv("EBAY_CLIENT_ID", "")
    EBAY_CLIENT_SECRET: str = os.getenv("EBAY_CLIENT_SECRET", "")
    EBAY_MARKETPLACE: str = os.getenv("EBAY_MARKETPLACE", "EBAY_FR")
    # Amazon Product Advertising API v5
    AMAZON_ACCESS_KEY: str = os.getenv("AMAZON_ACCESS_KEY", "")
    AMAZON_SECRET_KEY: str = os.getenv("AMAZON_SECRET_KEY", "")
    AMAZON_PARTNER_TAG: str = os.getenv("AMAZON_PARTNER_TAG", "")
    AMAZON_HOST: str = os.getenv("AMAZON_HOST", "webservices.amazon.fr")
    AMAZON_REGION: str = os.getenv("AMAZON_REGION", "eu-west-1")
    AMAZON_MARKETPLACE: str = os.getenv("AMAZON_MARKETPLACE", "www.amazon.fr")
    # AliExpress Open Platform
    ALIEXPRESS_APP_KEY: str = os.getenv("ALIEXPRESS_APP_KEY", "")
    ALIEXPRESS_APP_SECRET: str = os.getenv("ALIEXPRESS_APP_SECRET", "")
    ALIEXPRESS_TRACKING_ID: str = os.getenv("ALIEXPRESS_TRACKING_ID", "")
    # Google Merchant / Content API
    GOOGLE_MERCHANT_ID: str = os.getenv("GOOGLE_MERCHANT_ID", "")
    GOOGLE_APPLICATION_CREDENTIALS: str = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "")
    # UPCitemDB (trial sans clé, ou clé pour le plan payant)
    UPCITEMDB_KEY: str = os.getenv("UPCITEMDB_KEY", "")
    # Barcode Lookup
    BARCODE_LOOKUP_KEY: str = os.getenv("BARCODE_LOOKUP_KEY", "")
    # OpenStreetMap
    NOMINATIM_URL: str = os.getenv("NOMINATIM_URL", "https://nominatim.openstreetmap.org")
    OVERPASS_URL: str = os.getenv("OVERPASS_URL", "https://overpass-api.de/api/interpreter")

    # --- Pool de proxies publics ---
    PROXY_POOL_ENABLED: bool = _bool("PROXY_POOL_ENABLED", False)
    PROXY_REFRESH_MINUTES: int = int(os.getenv("PROXY_REFRESH_MINUTES", "30"))
    PROXY_FETCH_TIMEOUT: int = int(os.getenv("PROXY_FETCH_TIMEOUT", "20"))
    PROXY_TEST_URL: str = os.getenv("PROXY_TEST_URL", "http://httpbin.org/ip")
    PROXY_TEST_TIMEOUT: float = _float("PROXY_TEST_TIMEOUT", 8.0)
    PROXY_TEST_WORKERS: int = int(os.getenv("PROXY_TEST_WORKERS", "50"))
    PROXY_TEST_LIMIT: int = int(os.getenv("PROXY_TEST_LIMIT", "400"))
    PROXY_MAX_FAILS: int = int(os.getenv("PROXY_MAX_FAILS", "3"))


settings = Settings()
