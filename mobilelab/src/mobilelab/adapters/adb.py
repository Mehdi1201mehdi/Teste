"""Adaptateur Android via ADB (Android Debug Bridge).

N'utilise que des commandes documentées (`devices -l`, `getprop`, `df`, `find`, `stat`,
`pull`) et se limite au stockage partagé de l'utilisateur. Aucun accès root.
"""

from __future__ import annotations

import re
import shlex
from pathlib import Path

from mobilelab.adapters.base import DeviceAdapter, FileTransferAdapter
from mobilelab.core.errors import CommandError
from mobilelab.core.logging_setup import get_logger
from mobilelab.core.models import ConnectionState, Device, Platform, RemoteFile, StorageInfo
from mobilelab.core.paths import validate_android_path
from mobilelab.core.runner import CommandRunner

log = get_logger("adb")

# Propriétés lues : identification matérielle et version, rien de personnel.
PROPERTY_WHITELIST = (
    "ro.product.manufacturer",
    "ro.product.model",
    "ro.product.brand",
    "ro.product.device",
    "ro.build.version.release",
    "ro.build.version.sdk",
    "ro.build.version.security_patch",
    "ro.product.cpu.abi",
)

_STATE_MAP = {
    "device": ConnectionState.READY,
    "unauthorized": ConnectionState.UNAUTHORIZED,
    "offline": ConnectionState.OFFLINE,
    "recovery": ConnectionState.RECOVERY,
    "sideload": ConnectionState.RECOVERY,
    "rescue": ConnectionState.RECOVERY,
    "bootloader": ConnectionState.BOOTLOADER,
    "authorizing": ConnectionState.UNAUTHORIZED,
    "connecting": ConnectionState.OFFLINE,
}

_SERIAL_RE = re.compile(r"^[\w.:\-\[\]@?]+$")  # « ???? » : appareil sans permission USB
_PROP_RE = re.compile(r"^\[([^\]]+)\]: \[(.*)\]$")


def parse_devices(output: str) -> list[tuple[str, str, dict[str, str]]]:
    """Analyse la sortie de `adb devices -l` → [(serial, état brut, attributs)]."""
    result = []
    for raw in output.splitlines():
        line = raw.strip()
        if not line or line.startswith(("List of devices", "*", "adb server")):
            continue
        if "no permissions" in line:
            serial = line.split()[0]
            result.append((serial, "no permissions", {}))
            continue
        parts = line.split()
        if len(parts) < 2:
            continue
        serial, state, *rest = parts
        attrs = dict(p.split(":", 1) for p in rest if ":" in p)
        result.append((serial, state, attrs))
    return result


def parse_getprop(output: str) -> dict[str, str]:
    props = {}
    for line in output.splitlines():
        m = _PROP_RE.match(line.strip())
        if m and m.group(1) in PROPERTY_WHITELIST:
            props[m.group(1)] = m.group(2)
    return props


def parse_find_stat(output: str) -> list[RemoteFile]:
    files = []
    for line in output.splitlines():
        parts = line.split("|", 2)
        if len(parts) != 3 or not parts[0].isdigit():
            continue  # ex. « Permission denied » : ignoré, journalisé par l'appelant
        files.append(RemoteFile(path=parts[2], size=int(parts[0]), mtime=int(parts[1] or 0)))
    return files


def parse_df(output: str) -> StorageInfo | None:
    lines = [ln for ln in output.splitlines() if ln.strip()]
    if len(lines) < 2:
        return None
    cols = lines[-1].split()
    try:
        total_k, _used_k, avail_k = int(cols[1]), int(cols[2]), int(cols[3])
    except (IndexError, ValueError):
        return None
    return StorageInfo(total_bytes=total_k * 1024, free_bytes=avail_k * 1024)


class AdbAdapter(DeviceAdapter, FileTransferAdapter):
    platform = Platform.ANDROID

    def __init__(self, runner: CommandRunner) -> None:
        self.runner = runner

    # -- détection -------------------------------------------------------------
    def list_devices(self) -> list[Device]:
        res = self.runner.run("adb", ["devices", "-l"], timeout=15)
        if not res.ok:
            raise CommandError("adb devices a échoué.", res.stderr.strip() or None)
        devices = []
        for serial, raw_state, attrs in parse_devices(res.stdout):
            if not _SERIAL_RE.match(serial):
                log.warning("Numéro de série ignoré (format inattendu).")
                continue
            state = _STATE_MAP.get(raw_state, ConnectionState.UNKNOWN)
            props: dict[str, str] = {}
            if raw_state == "no permissions":
                props["hint"] = "udev"
            model = attrs.get("model", "").replace("_", " ")
            manufacturer = ""
            os_version = ""
            if state.usable:
                try:
                    props.update(self.properties(serial))
                except CommandError as exc:
                    log.warning("Lecture des propriétés impossible pour un appareil : %s", exc)
                model = props.get("ro.product.model", model)
                manufacturer = props.get("ro.product.manufacturer", "")
                release = props.get("ro.build.version.release")
                os_version = f"Android {release}" if release else ""
            transport = "réseau" if ":" in serial else "usb"
            if serial.startswith("emulator-"):
                transport = "émulateur"
            devices.append(
                Device(serial, Platform.ANDROID, state, model, manufacturer, os_version,
                       transport, properties=props)
            )
        return devices

    def properties(self, serial: str) -> dict[str, str]:
        res = self.runner.run("adb", ["-s", serial, "shell", "getprop"], timeout=15)
        if not res.ok:
            raise CommandError("getprop a échoué.", res.stderr.strip() or None)
        return parse_getprop(res.stdout)

    # -- fichiers --------------------------------------------------------------
    def list_files(self, serial: str, root: str) -> list[RemoteFile]:
        root = validate_android_path(root)
        # Commande distante construite avec un chemin validé ET échappé.
        remote_cmd = f"find {shlex.quote(root)} -type f -exec stat -c '%s|%Y|%n' {{}} +"
        res = self.runner.run("adb", ["-s", serial, "shell", remote_cmd], timeout=300)
        files = parse_find_stat(res.stdout)
        denied = res.stdout.count("Permission denied") + res.stderr.count("Permission denied")
        if denied:
            log.info("%d élément(s) inaccessible(s) sous %s (permissions Android).", denied, root)
        if not res.ok and not files and "No such file" in (res.stderr + res.stdout):
            return []
        # Sécurité : on ne garde que les chemins qui restent sous la racine validée.
        return [f for f in files if f.path == root or f.path.startswith(root.rstrip("/") + "/")]

    def pull(self, serial: str, remote: str, local: Path) -> None:
        remote = validate_android_path(remote)
        local.parent.mkdir(parents=True, exist_ok=True)
        res = self.runner.run("adb", ["-s", serial, "pull", "-a", remote, str(local)], timeout=900)
        if not res.ok:
            raise CommandError(f"Copie impossible : {remote}", res.stderr.strip() or None)

    def storage(self, serial: str) -> StorageInfo | None:
        res = self.runner.run("adb", ["-s", serial, "shell", "df -k /sdcard"], timeout=15)
        return parse_df(res.stdout) if res.ok else None
