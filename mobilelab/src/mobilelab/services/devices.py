"""Agrégation des appareils de tous les adaptateurs actifs + aide contextuelle."""

from __future__ import annotations

from dataclasses import dataclass, field

from mobilelab.adapters.base import DeviceAdapter
from mobilelab.core.errors import MobileLabError
from mobilelab.core.logging_setup import get_logger
from mobilelab.core.models import ConnectionState, Device, Platform

log = get_logger("devices")


@dataclass
class ScanResult:
    devices: list[Device] = field(default_factory=list)
    problems: list[str] = field(default_factory=list)


class DeviceService:
    def __init__(self, adapters: list[DeviceAdapter]) -> None:
        self.adapters = adapters

    def scan(self) -> ScanResult:
        result = ScanResult()
        for adapter in self.adapters:
            try:
                result.devices.extend(adapter.list_devices())
            except MobileLabError as exc:
                log.warning("Détection %s : %s", adapter.platform.value, exc)
                result.problems.append(str(exc))
        log.debug("Détection : %d appareil(s).", len(result.devices))  # appelé toutes les 4 s
        return result

    def adapter_for(self, device: Device) -> DeviceAdapter:
        for a in self.adapters:
            if a.platform is device.platform and a.simulated == device.simulated:
                return a
        raise MobileLabError("Aucun adaptateur pour cet appareil.")


def help_for(device: Device) -> list[str]:
    """Conseils actionnables selon l'état de connexion."""
    s = device.state
    if device.platform is Platform.ANDROID:
        if device.properties.get("hint") == "udev":
            return [
                "Linux refuse l'accès USB à l'appareil.",
                "Ajoutez votre utilisateur au groupe « plugdev » et installez les règles udev "
                "Android (paquet android-sdk-platform-tools-common), puis rebranchez.",
            ]
        if s is ConnectionState.UNAUTHORIZED:
            return [
                "Déverrouillez le téléphone : une fenêtre « Autoriser le débogage USB ? » "
                "doit apparaître.",
                "Acceptez-la (cochez « Toujours autoriser » sur un ordinateur de confiance).",
                "Si rien n'apparaît : Options pour les développeurs → Révoquer les "
                "autorisations de débogage USB, puis rebranchez.",
            ]
        if s is ConnectionState.OFFLINE:
            return ["Débranchez/rebranchez le câble ; essayez un câble de données, un autre port.",
                    "Redémarrez le serveur ADB depuis l'onglet Diagnostic."]
        if s in (ConnectionState.RECOVERY, ConnectionState.BOOTLOADER):
            return ["L'appareil n'est pas démarré normalement : redémarrez-le sur Android "
                    "pour accéder à vos fichiers."]
    else:
        if s is ConnectionState.UNPAIRED:
            return ["Déverrouillez l'iPhone/iPad et touchez « Se fier » (Faire confiance à "
                    "cet ordinateur), puis saisissez le code de l'appareil.",
                    "Sous Windows, Apple Mobile Device Support (fourni avec iTunes / "
                    "Appareils Apple) doit être installé."]
    if s is ConnectionState.READY:
        return ["Appareil prêt."]
    return ["État non reconnu : consultez le journal et l'onglet Diagnostic."]


ANDROID_SETUP_STEPS = [
    "Paramètres → À propos du téléphone → touchez 7 fois « Numéro de build ».",
    "Paramètres → Système → Options pour les développeurs → activez « Débogage USB ».",
    "Branchez le câble, déverrouillez et acceptez l'empreinte de cet ordinateur.",
    "Windows : installez le pilote USB du fabricant (ou Google USB Driver) si l'appareil "
    "n'apparaît pas.",
]
