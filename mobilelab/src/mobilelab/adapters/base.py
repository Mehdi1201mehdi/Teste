"""Contrats des adaptateurs d'appareils (couche système)."""

from __future__ import annotations

import threading
from abc import ABC, abstractmethod
from collections.abc import Callable
from pathlib import Path

from mobilelab.core.models import AppPackage, Device, Platform, RemoteFile, StorageInfo

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


class DeviceManagerAdapter(ABC):
    """Gestion d'un appareil Android autorisé : applications, capture, envoi de fichiers.

    Toutes ces opérations passent par des commandes ADB documentées et exigent que
    l'utilisateur ait autorisé le débogage USB sur l'appareil.
    """

    @abstractmethod
    def list_packages(self, serial: str, include_system: bool = False) -> list[AppPackage]: ...

    @abstractmethod
    def apk_paths(self, serial: str, package: str) -> list[str]: ...

    @abstractmethod
    def pull_apk(self, serial: str, remote: str, local: Path) -> None: ...

    @abstractmethod
    def install(self, serial: str, apks: list[Path]) -> str: ...

    @abstractmethod
    def uninstall(self, serial: str, package: str) -> str: ...

    @abstractmethod
    def screenshot(self, serial: str) -> bytes: ...

    @abstractmethod
    def push(self, serial: str, local: Path, remote: str) -> None: ...

    @abstractmethod
    def remote_exists(self, serial: str, remote: str) -> bool: ...
