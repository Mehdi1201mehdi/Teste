"""Modèles de données partagés entre couches (aucune dépendance Qt)."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path


class Platform(str, Enum):
    ANDROID = "android"
    IOS = "ios"


class ConnectionState(str, Enum):
    READY = "ready"  # autorisé, utilisable
    UNAUTHORIZED = "unauthorized"  # autorisation à accepter sur l'appareil
    OFFLINE = "offline"
    RECOVERY = "recovery"
    BOOTLOADER = "bootloader"
    UNPAIRED = "unpaired"  # iOS : « Faire confiance à cet ordinateur » non accepté
    UNKNOWN = "unknown"

    @property
    def label(self) -> str:
        return _STATE_LABELS[self]

    @property
    def usable(self) -> bool:
        return self is ConnectionState.READY


_STATE_LABELS = {
    ConnectionState.READY: "Connecté",
    ConnectionState.UNAUTHORIZED: "Autorisation requise",
    ConnectionState.OFFLINE: "Hors ligne",
    ConnectionState.RECOVERY: "Mode recovery",
    ConnectionState.BOOTLOADER: "Mode bootloader",
    ConnectionState.UNPAIRED: "Appairage requis",
    ConnectionState.UNKNOWN: "État inconnu",
}


@dataclass(frozen=True)
class Device:
    serial: str
    platform: Platform
    state: ConnectionState
    model: str = ""
    manufacturer: str = ""
    os_version: str = ""
    transport: str = "usb"
    simulated: bool = False
    properties: dict[str, str] = field(default_factory=dict, compare=False, hash=False)

    @property
    def display_name(self) -> str:
        name = " ".join(p for p in (self.manufacturer, self.model) if p).strip()
        return name or self.serial


@dataclass(frozen=True)
class RemoteFile:
    """Fichier présent sur l'appareil (chemin absolu côté appareil)."""

    path: str
    size: int
    mtime: int = 0


@dataclass(frozen=True)
class StorageInfo:
    total_bytes: int
    free_bytes: int


@dataclass
class BackupEntry:
    """Ligne du manifeste de sauvegarde (provenance + intégrité)."""

    source: str  # chemin sur l'appareil
    relative_path: str  # chemin relatif dans la sauvegarde
    size: int
    sha256: str
    status: str = "ok"  # ok | error
    error: str = ""


@dataclass
class BackupResult:
    backup_id: str
    destination: Path
    device_serial: str
    entries: list[BackupEntry] = field(default_factory=list)
    simulated: bool = False

    @property
    def ok_count(self) -> int:
        return sum(1 for e in self.entries if e.status == "ok")

    @property
    def error_count(self) -> int:
        return sum(1 for e in self.entries if e.status != "ok")

    @property
    def total_bytes(self) -> int:
        return sum(e.size for e in self.entries if e.status == "ok")
