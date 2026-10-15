"""Appareils SIMULÉS pour tester l'interface sans matériel.

Tout ce qui sort de ce module est marqué `simulated=True` et les fichiers produits
commencent par un en-tête explicite : ils ne doivent jamais passer pour des données réelles.
"""

from __future__ import annotations

import threading
import time
from pathlib import Path

from mobilelab.adapters.base import (
    DeviceAdapter,
    FileTransferAdapter,
    FullBackupAdapter,
    LineCallback,
)
from mobilelab.core.errors import CommandError
from mobilelab.core.models import ConnectionState, Device, Platform, RemoteFile, StorageInfo
from mobilelab.core.paths import validate_android_path

SIM_HEADER = b"MOBILELAB-SIMULATION - fichier factice, aucune donnee reelle\n"

_FILES = {
    "/sdcard/DCIM/Camera/IMG_0001.jpg": 48_000,
    "/sdcard/DCIM/Camera/IMG_0002.jpg": 52_500,
    "/sdcard/DCIM/Camera/VID_0003.mp4": 310_000,
    "/sdcard/Download/facture.pdf": 18_200,
    "/sdcard/Documents/notes.txt": 1_200,
    "/sdcard/Music/demo.mp3": 96_000,
}


def simulated_content(path: str, size: int) -> bytes:
    body = (path.encode() + b"\n") * (size // (len(path) + 1) + 1)
    return (SIM_HEADER + body)[:max(size, len(SIM_HEADER))]


class SimulatedAndroidAdapter(DeviceAdapter, FileTransferAdapter):
    platform = Platform.ANDROID
    simulated = True

    def __init__(self, delay: float = 0.0) -> None:
        self.delay = delay

    def list_devices(self) -> list[Device]:
        return [
            Device("SIM-ANDROID-01", Platform.ANDROID, ConnectionState.READY, "Pixel (simulé)",
                   "Démo", "Android 15", simulated=True,
                   properties={"ro.build.version.sdk": "35"}),
            Device("SIM-ANDROID-02", Platform.ANDROID, ConnectionState.UNAUTHORIZED,
                   "Galaxy (simulé)", "Démo", simulated=True),
        ]

    def list_files(self, serial: str, root: str) -> list[RemoteFile]:
        root = validate_android_path(root).rstrip("/")
        return [RemoteFile(p, s, 1_700_000_000) for p, s in _FILES.items()
                if p.startswith(root + "/")]

    def pull(self, serial: str, remote: str, local: Path) -> None:
        remote = validate_android_path(remote)
        if remote not in _FILES:
            raise CommandError(f"Fichier simulé absent : {remote}")
        time.sleep(self.delay)
        local.parent.mkdir(parents=True, exist_ok=True)
        local.write_bytes(simulated_content(remote, _FILES[remote]))

    def storage(self, serial: str) -> StorageInfo | None:
        return StorageInfo(total_bytes=128 * 1024**3, free_bytes=42 * 1024**3)


class SimulatedIosAdapter(DeviceAdapter, FullBackupAdapter):
    platform = Platform.IOS
    simulated = True

    def list_devices(self) -> list[Device]:
        return [
            Device("00008110-SIMULATED00001", Platform.IOS, ConnectionState.READY,
                   "iPhone (simulé)", "Apple", "iOS 18.0", simulated=True),
        ]

    def create_backup(self, serial: str, destination: Path, on_line: LineCallback,
                      cancel: threading.Event | None = None) -> None:
        destination.mkdir(parents=True, exist_ok=True)
        for pct in (0, 25, 50, 75, 100):
            if cancel is not None and cancel.is_set():
                raise CommandError("Sauvegarde annulée.")
            on_line(f"[SIMULATION] progression {pct}%")
        (destination / "SIMULATION.txt").write_bytes(SIM_HEADER)
