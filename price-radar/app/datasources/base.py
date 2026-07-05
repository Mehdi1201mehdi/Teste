"""Connecteur générique REST pour le module 'Sources API gratuites'.

Un seul connecteur, piloté par le catalogue (sources.config.json), fournit :
- testConnection(), fetchData(), normalizeData(), errorHandler()
- limitation de débit (rate limit) par source, timeout, retry + backoff
- gestion propre des erreurs HTTP 401/403/404/429/500 avec alternative
- résolution des clés côté serveur (env d'abord, puis réglages), JAMAIS
  renvoyées au frontend ni écrites dans les logs (masquage systématique).
"""
import logging
import os
import time

import requests

logger = logging.getLogger("price-radar.datasources")

TIMEOUT = 20
RETRIES = 3

# Erreurs HTTP → message clair + faut-il proposer une alternative
HTTP_MESSAGES = {
    401: "401 Non autorisé — clé API invalide ou manquante.",
    403: "403 Interdit — accès refusé (clé, quota ou protection anti-bot). "
         "On NE contourne PAS les protections : utilise une alternative.",
    404: "404 Introuvable — endpoint ou ressource inexistant.",
    429: "429 Trop de requêtes — quota/limite atteint, réessaie plus tard.",
    500: "500 Erreur serveur distant.",
}


def _mask(value: str | None) -> str:
    if not value:
        return ""
    return value[:3] + "…" + value[-2:] if len(value) > 6 else "•••"


# Rate limit mémoire : source_id -> timestamp du dernier appel
_last_call: dict[str, float] = {}


def _resolve_key(env_key: str, db=None) -> str | None:
    """Clé depuis l'environnement, sinon depuis les réglages (table settings).
    Jamais renvoyée telle quelle au client."""
    if not env_key:
        return None
    value = os.getenv(env_key)
    if value:
        return value
    if db is not None:
        from ..services.alerts import get_setting
        stored = get_setting(db, f"apikey:{env_key}", "")
        return stored or None
    return None


class GenericRESTConnector:
    min_interval = 1.0  # délai mini par défaut entre 2 appels à une même source

    # -------------------------------------------------------------- helpers
    def _throttle(self, source_id: str):
        last = _last_call.get(source_id, 0.0)
        elapsed = time.time() - last
        if elapsed < self.min_interval:
            time.sleep(self.min_interval - elapsed)
        _last_call[source_id] = time.time()

    def errorHandler(self, source: dict, *, status: int | None = None,
                     exc: Exception | None = None) -> dict:
        alt = source.get("alternative")
        if status and status in HTTP_MESSAGES:
            msg = HTTP_MESSAGES[status]
        elif exc is not None:
            msg = f"Erreur réseau : {type(exc).__name__}"
        else:
            msg = f"Erreur HTTP {status}" if status else "Erreur inconnue"
        out = {"ok": False, "status": "error", "http": status, "message": msg}
        if alt:
            out["alternative"] = alt
            out["message"] += f" Alternative sans clé : « {alt} »."
        return out

    def _auth(self, source: dict, url: str, headers: dict, key: str | None):
        """Injecte la clé selon test.auth_in (query|header). Retourne url."""
        test = source.get("test", {})
        auth_in = test.get("auth_in", "query")
        param = test.get("auth_param", "")
        if not key or not param:
            return url
        if auth_in == "header":
            headers[param] = key
        else:  # query
            sep = "&" if "?" in url else "?"
            url = f"{url}{sep}{param}={key}"
        return url

    def _request(self, source: dict, path: str, db=None) -> dict:
        """GET avec retry/backoff, injection de clé, gestion d'erreurs."""
        env_key = source.get("envKey", "")
        key = _resolve_key(env_key, db)
        # Source à clé non configurée : on n'appelle pas, message propre
        if source.get("authType", "none") != "none" and not key:
            out = {"ok": False, "status": "unconfigured",
                   "message": f"Clé requise : renseigne {env_key} dans .env "
                              f"(ou via le champ dédié)."}
            if source.get("alternative"):
                out["alternative"] = source["alternative"]
            return out

        url = source["baseUrl"].rstrip("/") + path
        headers = {"User-Agent": "price-radar/1.0", "Accept": "application/json"}
        url = self._auth(source, url, headers, key)

        self._throttle(source["id"])
        last_exc = None
        for attempt in range(RETRIES):
            try:
                resp = requests.get(url, headers=headers, timeout=TIMEOUT)
            except requests.RequestException as exc:
                last_exc = exc
                time.sleep(2 ** attempt)  # backoff
                continue
            if resp.status_code == 429 and attempt < RETRIES - 1:
                time.sleep(2 ** (attempt + 1))
                continue
            if resp.status_code >= 400:
                return self.errorHandler(source, status=resp.status_code)
            try:
                payload = resp.json()
            except ValueError:
                payload = {"_text": resp.text[:2000]}
            return {"ok": True, "status": "ok", "http": resp.status_code,
                    "payload": payload}
        return self.errorHandler(source, exc=last_exc)

    # -------------------------------------------------------------- API
    def testConnection(self, source: dict, db=None) -> dict:
        """Teste l'accès. Frameworks/listes : pas d'endpoint à tester."""
        kind = source.get("kind", "api")
        if kind == "framework":
            return {"ok": True, "status": "info",
                    "message": "Framework open source — s'installe localement, "
                               "pas d'endpoint à tester.",
                    "docs": source.get("docs")}
        if kind == "list":
            return {"ok": True, "status": "info",
                    "message": "Répertoire de listes d'API — pas d'endpoint.",
                    "docs": source.get("docs")}
        test = source.get("test")
        if not test:
            return {"ok": True, "status": "info",
                    "message": "Pas de test automatique défini pour cette "
                               "source (voir la doc).", "docs": source.get("docs")}
        start = time.time()
        res = self._request(source, test["path"], db)
        res["ms"] = int((time.time() - start) * 1000)
        if res.get("ok"):
            res["message"] = "Connexion OK."
            res.pop("payload", None)
        return res

    def normalizeData(self, payload) -> list[dict]:
        """Extraction générique d'une liste d'enregistrements depuis un JSON
        de forme variable (liste directe, ou 1re valeur liste d'un dict)."""
        if isinstance(payload, list):
            return [x if isinstance(x, dict) else {"value": x} for x in payload]
        if isinstance(payload, dict):
            for value in payload.values():
                if isinstance(value, list) and value:
                    return [x if isinstance(x, dict) else {"value": x}
                            for x in value]
            return [payload]
        return [{"value": payload}]

    def fetchData(self, source: dict, path: str | None = None, db=None) -> dict:
        """Collecte : appelle l'endpoint (test.path par défaut) et normalise."""
        kind = source.get("kind", "api")
        if kind in ("framework", "list"):
            return {"ok": False, "status": "info",
                    "message": "Source non appelable (framework/liste)."}
        p = path or source.get("test", {}).get("path")
        if not p:
            return {"ok": False, "status": "error",
                    "message": "Aucun chemin de collecte : précise un endpoint."}
        res = self._request(source, p, db)
        if not res.get("ok"):
            return res
        records = self.normalizeData(res["payload"])
        return {"ok": True, "status": "ok", "count": len(records),
                "records": records}


connector = GenericRESTConnector()
