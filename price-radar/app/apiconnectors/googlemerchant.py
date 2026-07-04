"""Google Merchant / Content API for Shopping.
Sert principalement à lire/gérer TES propres produits marchands (pas un
comparateur public). Nécessite un compte Merchant + identifiants OAuth
(service account via GOOGLE_APPLICATION_CREDENTIALS).
Docs : https://developers.google.com/merchant

Implémenté comme connecteur désactivé tant que les identifiants ne sont pas
fournis. La liste des produits de ton compte est exposée via list_products().
"""
from ..config import settings
from .base import APIConnector, APIOffer
from .registry import register


@register
class GoogleMerchant(APIConnector):
    name = "google_merchant"
    label = "Google Merchant"
    kind = "catalog"
    docs = "https://developers.google.com/merchant"
    required_env = ("GOOGLE_MERCHANT_ID", "GOOGLE_APPLICATION_CREDENTIALS")
    min_interval = 0.5
    cache_ttl = 1800

    def _access_token(self) -> str | None:
        """Jeton OAuth via compte de service (google-auth, optionnel)."""
        try:
            from google.oauth2 import service_account  # type: ignore
            from google.auth.transport.requests import Request  # type: ignore
        except ImportError:
            self.log.info("google-auth non installé : connecteur inactif")
            return None
        try:
            creds = service_account.Credentials.from_service_account_file(
                settings.GOOGLE_APPLICATION_CREDENTIALS,
                scopes=["https://www.googleapis.com/auth/content"])
            creds.refresh(Request())
            return creds.token
        except Exception as exc:
            self.log.warning("OAuth Google Merchant échoué : %s", exc)
            return None

    def list_products(self, limit: int = 25) -> list[APIOffer]:
        if not self.configured:
            return []
        token = self._access_token()
        if not token:
            return []
        url = (f"https://shoppingcontent.googleapis.com/content/v2.1/"
               f"{settings.GOOGLE_MERCHANT_ID}/products")
        data = self._get(url, params={"maxResults": min(limit, 250)},
                         headers={"Authorization": f"Bearer {token}"},
                         cache_key=f"gmerchant:{limit}")
        offers: list[APIOffer] = []
        for p in (data or {}).get("resources", [])[:limit]:
            price = p.get("price", {}) or {}
            try:
                value = float(price.get("value")) if price.get("value") else None
            except (TypeError, ValueError):
                value = None
            offers.append(APIOffer(
                source=self.name, title=p.get("title", ""), price=value,
                currency=price.get("currency", "EUR"),
                availability=p.get("availability", "unknown"),
                seller="Google Merchant", image=p.get("imageLink", ""),
                url=p.get("link", ""), brand=p.get("brand", ""),
                ean=str(p.get("gtin", "")),
                category=p.get("googleProductCategory", "")))
        return offers

    def search(self, query: str, limit: int = 10) -> list[APIOffer]:
        # Filtrage local sur le catalogue du compte marchand
        q = query.lower()
        return [o for o in self.list_products(250)
                if q in o.title.lower()][:limit]
