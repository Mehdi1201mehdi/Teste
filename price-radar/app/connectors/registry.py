"""Registre des connecteurs. Chaque module de site s'enregistre via
@register. Ajouter un site = déposer un fichier ; le supprimer = retirer le
fichier. Aucune autre partie de l'application n'a besoin d'être modifiée.
"""
import logging
from urllib.parse import urlparse

from .base import BaseConnector

logger = logging.getLogger("price-radar.connectors")

_REGISTRY: dict[str, BaseConnector] = {}


def register(cls: type[BaseConnector]) -> type[BaseConnector]:
    """Décorateur d'enregistrement d'un connecteur de site."""
    instance = cls()
    if instance.name in _REGISTRY:
        logger.warning("Connecteur '%s' déjà enregistré, écrasé", instance.name)
    _REGISTRY[instance.name] = instance
    return cls


def all_connectors() -> list[BaseConnector]:
    return sorted(_REGISTRY.values(), key=lambda c: c.label.lower())


def by_name(name: str) -> BaseConnector | None:
    return _REGISTRY.get(name)


def for_url(url: str) -> BaseConnector:
    """Connecteur gérant cette URL, sinon le connecteur générique."""
    for connector in _REGISTRY.values():
        if connector.name != "generic" and connector.handles(url):
            return connector
    return _REGISTRY.get("generic") or BaseConnector()


def for_domain(domain: str) -> BaseConnector | None:
    domain = domain.replace("www.", "").lower()
    for connector in _REGISTRY.values():
        if domain in connector.domains:
            return connector
    return None
