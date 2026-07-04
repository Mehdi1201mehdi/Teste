"""Registre des connecteurs d'API. Chaque module d'API s'enregistre via
@register. Ajouter/retirer une API = ajouter/retirer un fichier."""
import logging

from .base import APIConnector

logger = logging.getLogger("price-radar.apiconnectors")

_REGISTRY: dict[str, APIConnector] = {}


def register(cls: type[APIConnector]) -> type[APIConnector]:
    instance = cls()
    _REGISTRY[instance.name] = instance
    return cls


def all_api_connectors() -> list[APIConnector]:
    return sorted(_REGISTRY.values(), key=lambda c: c.label.lower())


def by_name(name: str) -> APIConnector | None:
    return _REGISTRY.get(name)


def price_sources() -> list[APIConnector]:
    return [c for c in _REGISTRY.values() if c.kind == "price"]


def catalog_sources() -> list[APIConnector]:
    return [c for c in _REGISTRY.values() if c.kind == "catalog"]
