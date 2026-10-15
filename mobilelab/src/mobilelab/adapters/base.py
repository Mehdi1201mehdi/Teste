"""Contrats des adaptateurs d'appareils (couche système)."""

from __future__ import annotations

import threading
from abc import ABC, abstractmethod
from collections.abc import Callable
from pathlib import Path

from mobilelab.core.models import Device, Platform, RemoteFile, StorageInfo

LineCallback = Callable[[str], None]


class DeviceAdapter(ABC):
    """Détection d'appareils d'une plateforme donnée."""

    platform: Platform
    simulated: bool = False

    @abstractmethod
    def list_devices(self) -> list[Device]:
        """Liste les appareils visibles. Lève ToolNotFoundError si l'outil manque."""


class FileTransferAdapter(ABC):
    """Accès fichier par fichier (Android : stockage partagé via ADB)."""

    @abstractmethod
    def list_files(self, serial: str, root: str) -> list[RemoteFile]: ...

    @abstractmethod
    def pull(self, serial: str, remote: str, local: Path) -> None: ...

    @abstractmethod
    def storage(self, serial: str) -> StorageInfo | None: ...


class FullBackupAdapter(ABC):
    """Sauvegarde complète via le mécanisme officiel de la plateforme (iOS)."""

    @abstractmethod
    def create_backup(
        self,
        serial: str,
        destination: Path,
        on_line: LineCallback,
        cancel: threading.Event | None = None,
    ) -> None: ...
