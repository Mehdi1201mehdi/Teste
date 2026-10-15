"""Adaptateur Apple via libimobiledevice (projet open source, LGPL-2.1).

Utilise uniquement `idevice_id`, `ideviceinfo` et `idevicebackup2`, qui passent par
les services officiels de l'appareil après l'appairage « Faire confiance à cet ordinateur ».
"""

from __future__ import annotations

import re
import threading
from pathlib import Path

from mobilelab.adapters.base import DeviceAdapter, FullBackupAdapter, LineCallback
from mobilelab.core.errors import CommandError
from mobilelab.core.logging_setup import get_logger
from mobilelab.core.models import ConnectionState, Device, Platform
from mobilelab.core.runner import CommandRunner

log = get_logger("ios")

INFO_WHITELIST = (
    "ProductType",
    "ProductVersion",
    "BuildVersion",
    "DeviceClass",
    "HardwareModel",
    "ModelNumber",
    "CPUArchitecture",
)

_UDID_RE = re.compile(r"^[0-9A-Fa-f-]{24,40}$")
_PAIRING_ERRORS = ("pair", "lockdownd", "trust", "PasswordProtected")


def parse_udids(output: str) -> list[str]:
    return [ln.strip() for ln in output.splitlines() if _UDID_RE.match(ln.strip())]


def parse_ideviceinfo(output: str) -> dict[str, str]:
    info = {}
    for line in output.splitlines():
        key, sep, value = line.partition(": ")
        if sep and key in INFO_WHITELIST:
            info[key] = value.strip()
    return info


class LibimobiledeviceAdapter(DeviceAdapter, FullBackupAdapter):
    platform = Platform.IOS

    def __init__(self, runner: CommandRunner) -> None:
        self.runner = runner

    def list_devices(self) -> list[Device]:
        res = self.runner.run("idevice_id", ["-l"], timeout=15)
        if not res.ok:
            raise CommandError(
                "Liste des appareils Apple indisponible.",
                "Le service usbmuxd ne répond pas : installez/démarrez usbmuxd (Linux) "
                "ou Apple Mobile Device Support / iTunes (Windows).",
            )
        devices = []
        for udid in parse_udids(res.stdout):
            info = self.runner.run("ideviceinfo", ["-u", udid], timeout=20)
            text = info.stdout + info.stderr
            if not info.ok and any(k.lower() in text.lower() for k in _PAIRING_ERRORS):
                devices.append(Device(udid, Platform.IOS, ConnectionState.UNPAIRED,
                                      manufacturer="Apple"))
                continue
            if not info.ok:
                devices.append(Device(udid, Platform.IOS, ConnectionState.UNKNOWN,
                                      manufacturer="Apple"))
                continue
            props = parse_ideviceinfo(info.stdout)
            version = props.get("ProductVersion")
            devices.append(
                Device(udid, Platform.IOS, ConnectionState.READY,
                       model=props.get("ProductType", ""), manufacturer="Apple",
                       os_version=f"iOS {version}" if version else "", properties=props)
            )
        return devices

    def create_backup(
        self,
        serial: str,
        destination: Path,
        on_line: LineCallback,
        cancel: threading.Event | None = None,
    ) -> None:
        if not _UDID_RE.match(serial):
            raise CommandError("Identifiant d'appareil invalide.")
        destination.mkdir(parents=True, exist_ok=True)
        # Sauvegarde complète au format standard ; le chiffrement éventuel est celui
        # configuré sur l'appareil, MobileLab ne le modifie jamais.
        code = self.runner.stream(
            "idevicebackup2", ["-u", serial, "backup", "--full", str(destination)],
            on_line, cancel=cancel, timeout=6 * 3600,
        )
        if cancel is not None and cancel.is_set():
            raise CommandError("Sauvegarde annulée.")
        if code != 0:
            raise CommandError(
                f"idevicebackup2 a échoué (code {code}).",
                "Déverrouillez l'appareil, acceptez « Faire confiance » et réessayez.",
            )
