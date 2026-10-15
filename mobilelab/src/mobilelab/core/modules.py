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
    "manager", "Gestion Android",
    "Applications (liste, export APK, installation, désinstallation), capture d'écran et "
    "envoi de fichiers du PC vers le téléphone — sans jamais écraser un fichier existant.",
    Maturity.STABLE))
register(FeatureModule(
    "migration", "Restauration et migration",
    "Renvoie une sauvegarde MobileLab vers ce téléphone ou un autre appareil Android, dans un "
    "dossier dédié (/sdcard/MobileLab-Restauration), après vérification SHA-256.",
    Maturity.STABLE))
register(FeatureModule(
    "media-analysis", "Analyse de médias",
    "Doublons exacts (SHA-256), photos par année et par appareil photo (EXIF), photos "
    "géolocalisées (information de confidentialité).",
    Maturity.STABLE))
register(FeatureModule(
    "compare", "Comparaison de sauvegardes",
    "Fichiers ajoutés, supprimés ou modifiés entre deux sauvegardes MobileLab (par SHA-256).",
    Maturity.STABLE))
register(FeatureModule(
    "tools", "Installation des outils",
    "Téléchargement, avec votre accord, d'ADB (Google) et des outils Apple pour Windows "
    "(libimobiledevice), dans le dossier de MobileLab.",
    Maturity.STABLE))
register(FeatureModule(
    "leapp", "ALEAPP / iLEAPP",
    "Lance ces analyseurs open source (installés séparément) sur une sauvegarde.",
    Maturity.EXPERIMENTAL))
register(FeatureModule(
    "ios-apps", "Applications iOS",
    "Liste des applications d'un iPhone (ideviceinstaller). Format de sortie variable selon "
    "les versions : à valider avant intégration.",
    Maturity.PLANNED))
