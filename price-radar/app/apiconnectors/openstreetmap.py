"""OpenStreetMap — géolocalisation de magasins (Nominatim) et recherche de
points de vente autour d'un point (Overpass). Sans clé. Ces connecteurs ne
fournissent pas de prix : ils localisent les enseignes physiques.
Docs : https://nominatim.openstreetmap.org , https://overpass-api.de
"""
from ..config import settings
from .base import APIConnector
from .registry import register


@register
class Nominatim(APIConnector):
    name = "nominatim"
    label = "OpenStreetMap Nominatim"
    kind = "geo"
    docs = "https://nominatim.openstreetmap.org"
    min_interval = 1.0        # règle d'usage Nominatim : max 1 req/s
    cache_ttl = 86400

    def geocode(self, query: str, limit: int = 5) -> list[dict]:
        data = self._get(f"{settings.NOMINATIM_URL}/search",
                         params={"q": query, "format": "json", "limit": limit},
                         cache_key=f"nominatim:{query}:{limit}")
        out = []
        for r in (data or [])[:limit]:
            out.append({"name": r.get("display_name", ""),
                        "lat": r.get("lat"), "lon": r.get("lon"),
                        "type": r.get("type", "")})
        return out


@register
class Overpass(APIConnector):
    name = "overpass"
    label = "OpenStreetMap Overpass"
    kind = "geo"
    docs = "https://overpass-api.de"
    min_interval = 2.0
    cache_ttl = 86400

    def shops_near(self, lat: float, lon: float, radius_m: int = 2000,
                   shop: str = "") -> list[dict]:
        shop_filter = f'["shop"="{shop}"]' if shop else '["shop"]'
        query = (f'[out:json][timeout:25];'
                 f'node{shop_filter}(around:{radius_m},{lat},{lon});'
                 f'out body 40;')
        data = self._request("POST", settings.OVERPASS_URL, data={"data": query},
                             cache_key=f"overpass:{lat}:{lon}:{radius_m}:{shop}")
        out = []
        for el in (data or {}).get("elements", []):
            tags = el.get("tags", {})
            out.append({"name": tags.get("name", ""),
                        "shop": tags.get("shop", ""),
                        "lat": el.get("lat"), "lon": el.get("lon"),
                        "brand": tags.get("brand", "")})
        return out
