"""Appareils SIMULÉS pour tester l'interface sans matériel.

Tout ce qui sort de ce module est marqué `simulated=True` et les fichiers produits
commencent par un en-tête explicite : ils ne doivent jamais passer pour des données réelles.
"""

from __future__ import annotations

import struct
import threading
import time
import zlib
from pathlib import Path

from mobilelab.adapters.base import (
    DeviceAdapter,
    DeviceManagerAdapter,
    FileTransferAdapter,
    FullBackupAdapter,
    LineCallback,
)
from mobilelab.core.errors import CommandError
from mobilelab.core.models import (
    AppPackage,
    ConnectionState,
    Device,
    Platform,
    RemoteFile,
    StorageInfo,
)
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


_APPS = [AppPackage("org.demo.notes", "42"), AppPackage("org.demo.photos", "310"),
         AppPackage("org.demo.meteo", "7")]


def simulated_png(width: int = 270, height: int = 585) -> bytes:
    """Image PNG unie (écran simulé), générée sans dépendance."""
    row = b"\x00" + bytes((76, 29, 149)) * width
    raw = zlib.compress(row * height, 9)

    def chunk(kind: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + kind + data
                + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF))

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", raw)
            + chunk(b"IEND", b""))


def simulated_content(path: str, size: int) -> bytes:
    body = (path.encode() + b"\n") * (size // (len(path) + 1) + 1)
    return (SIM_HEADER + body)[:max(size, len(SIM_HEADER))]


class SimulatedAndroidAdapter(DeviceAdapter, FileTransferAdapter, DeviceManagerAdapter):
    platform = Platform.ANDROID
    simulated = True

    def __init__(self, delay: float = 0.0) -> None:
        self.delay = delay
        self.apps = list(_APPS)
        self.pushed: dict[str, int] = {}

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

    # -- gestion simulée --------------------------------------------------------
    def list_packages(self, serial: str, include_system: bool = False) -> list[AppPackage]:
        if include_system:
            return [AppPackage("android.demo.system", "1", system=True)]
        return list(self.apps)

    def apk_paths(self, serial: str, package: str) -> list[str]:
        if package not in {a.name for a in self.apps}:
            raise CommandError(f"APK introuvable pour {package}.")
        return [f"/data/app/{package}-1/base.apk"]

    def pull_apk(self, serial: str, remote: str, local: Path) -> None:
        local.parent.mkdir(parents=True, exist_ok=True)
        local.write_bytes(SIM_HEADER + remote.encode())

    def install(self, serial: str, apks: list[Path]) -> str:
        name = "org.demo." + apks[0].stem.lower().replace("-", "_").replace(" ", "_")
        self.apps.append(AppPackage(name, "1"))
        return "Installation réussie (simulation)."

    def uninstall(self, serial: str, package: str) -> str:
        self.apps = [a for a in self.apps if a.name != package]
        return f"{package} désinstallée (simulation)."

    def screenshot(self, serial: str) -> bytes:
        return simulated_png()

    def push(self, serial: str, local: Path, remote: str) -> None:
        remote = validate_android_path(remote)
        time.sleep(self.delay)
        self.pushed[remote] = local.stat().st_size

    def remote_exists(self, serial: str, remote: str) -> bool:
        return remote in _FILES or remote in self.pushed


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
