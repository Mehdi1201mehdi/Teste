"""Vérification de l'IP publique utilisée pour le scan (directe ou via un
proxy), avec géolocalisation. S'appuie sur des API gratuites :
- ipify   : https://api.ipify.org?format=json   (IP publique)
- ip-api  : http://ip-api.com/json/{ip}          (géolocalisation, gratuit)
Tolérant : renvoie un statut d'erreur plutôt que de lever si l'API est
injoignable.
"""
import logging

import requests

logger = logging.getLogger("price-radar.ipcheck")


def current_ip(proxy: dict | None = None, timeout: int = 10) -> str | None:
    """IP publique vue depuis la connexion (ou via `proxy`)."""
    try:
        r = requests.get("https://api.ipify.org?format=json",
                         proxies=proxy, timeout=timeout)
        r.raise_for_status()
        return r.json().get("ip")
    except Exception as exc:
        logger.info("ipify injoignable : %s", exc)
        return None


def geolocate(ip: str, timeout: int = 10) -> dict:
    """Géolocalisation d'une IP via ip-api (gratuit, sans clé)."""
    try:
        r = requests.get(
            f"http://ip-api.com/json/{ip}"
            "?fields=status,country,countryCode,city,isp,query",
            timeout=timeout)
        data = r.json()
        if data.get("status") == "success":
            return {"country": data.get("country"),
                    "country_code": data.get("countryCode"),
                    "city": data.get("city"), "isp": data.get("isp"),
                    "ip": data.get("query")}
    except Exception as exc:
        logger.info("ip-api injoignable : %s", exc)
    return {}


def check(proxy_url: str | None = None) -> dict:
    """Vérifie l'IP (directe ou via proxy_url) et la géolocalise."""
    proxy = {"http": proxy_url, "https": proxy_url} if proxy_url else None
    ip = current_ip(proxy)
    if not ip:
        return {"ok": False, "via_proxy": bool(proxy_url),
                "error": "IP non déterminée (API injoignable ou proxy mort)"}
    return {"ok": True, "via_proxy": bool(proxy_url), "ip": ip,
            "geo": geolocate(ip)}
