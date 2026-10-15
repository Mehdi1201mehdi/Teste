"""Registre des modules fonctionnels (point d'extension).

Un module futur (migration, comparaison avancée, analyse de fichiers…) s'enregistre ici
avec un statut de maturité ; l'interface n'expose une page que pour les modules
disponibles, et liste les autres comme « prévus » sans les simuler.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from enum import Enum
from typing import Any


class Maturity(str, Enum):
    STABLE = "Disponible"
    EXPERIMENTAL = "Expérimental"
    PLANNED = "Prévu — non implémenté"


@dataclass(frozen=True)
class FeatureModule:
    id: str
    title: str
    description: str
    maturity: Maturity
    page_factory: Callable[..., Any] | None = None  # crée la page Qt si disponible


_REGISTRY: dict[str, FeatureModule] = {}


def register(module: FeatureModule) -> FeatureModule:
    if module.id in _REGISTRY:
        raise ValueError(f"Module déjà enregistré : {module.id}")
    _REGISTRY[module.id] = module
    return module


def modules() -> list[FeatureModule]:
    return list(_REGISTRY.values())


register(FeatureModule(
    "compare", "Comparaison de sauvegardes",
    "Fichiers ajoutés, supprimés ou modifiés entre deux sauvegardes MobileLab (par SHA-256).",
    Maturity.EXPERIMENTAL))
register(FeatureModule(
    "leapp", "ALEAPP / iLEAPP",
    "Lance ces analyseurs open source (installés séparément) sur une sauvegarde.",
    Maturity.EXPERIMENTAL))
register(FeatureModule(
    "migration", "Migration entre appareils",
    "Transfert de fichiers du stockage partagé d'un appareil vers un autre. "
    "Nécessite une validation technique (droits d'écriture, formats) avant implémentation.",
    Maturity.PLANNED))
register(FeatureModule(
    "media-analysis", "Analyse de fichiers",
    "Extraction EXIF/métadonnées, aperçus et doublons. À valider (dépendances, licences).",
    Maturity.PLANNED))
