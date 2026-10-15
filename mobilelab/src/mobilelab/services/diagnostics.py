"""Diagnostic de l'environnement : outils, services, espace disque, versions."""

from __future__ import annotations

import platform
import shutil
import sys
import zipfile
from dataclasses import asdict, dataclass
from enum import Enum
from pathlib import Path

from mobilelab import __version__
from mobilelab.core.errors import MobileLabError
from mobilelab.core.logging_setup import redact
from mobilelab.core.runner import TOOL_HINTS, CommandRunner


class Level(str, Enum):
    OK = "ok"
    WARN = "warn"
    ERROR = "error"
    INFO = "info"


@dataclass(frozen=True)
class Check:
    name: str
    level: Level
    detail: str
    hint: str = ""


def _first_line(text: str) -> str:
    return next((ln.strip() for ln in text.splitlines() if ln.strip()), "")


def run_checks(runner: CommandRunner, data_dir: Path) -> list[Check]:
    checks: list[Check] = [
        Check("MobileLab", Level.INFO, f"{__version__} — Python {sys.version.split()[0]} — "
              f"{platform.system()} {platform.release()}"),
    ]

    # ADB
    if runner.available("adb"):
        try:
            res = runner.run("adb", ["version"], timeout=10)
            checks.append(Check("ADB", Level.OK, _first_line(res.stdout)))
            res = runner.run("adb", ["devices"], timeout=15)
            text = res.stdout + res.stderr
            if not res.ok:
                checks.append(Check("Serveur ADB", Level.ERROR, _first_line(text),
                                    "Redémarrez le serveur ADB (bouton ci-dessous)."))
            elif "no permissions" in text:
                checks.append(Check("Accès USB (Android)", Level.ERROR,
                                    "Permissions USB insuffisantes.",
                                    "Linux : groupe plugdev + règles udev Android."))
            else:
                checks.append(Check("Serveur ADB", Level.OK, "Répond normalement."))
        except MobileLabError as exc:
            checks.append(Check("ADB", Level.ERROR, str(exc)))
    else:
        checks.append(Check("ADB", Level.WARN, "Non installé — appareils Android indisponibles.",
                            TOOL_HINTS["adb"]))

    # libimobiledevice
    if runner.available("idevice_id"):
        try:
            res = runner.run("idevice_id", ["-l"], timeout=10)
            if res.ok:
                checks.append(Check("libimobiledevice / usbmuxd", Level.OK, "Service joignable."))
            else:
                checks.append(Check(
                    "libimobiledevice / usbmuxd", Level.WARN,
                    _first_line(res.stdout + res.stderr) or "usbmuxd ne répond pas.",
                    "Linux : sudo systemctl start usbmuxd (ou branchez un appareil). "
                    "Windows : installez Apple Mobile Device Support."))
        except MobileLabError as exc:
            checks.append(Check("libimobiledevice", Level.ERROR, str(exc)))
        for tool in ("ideviceinfo", "idevicebackup2"):
            if not runner.available(tool):
                checks.append(Check(tool, Level.WARN, "Absent.", TOOL_HINTS[tool]))
    else:
        checks.append(Check("libimobiledevice", Level.WARN,
                            "Non installé — appareils Apple indisponibles.",
                            TOOL_HINTS["idevice_id"]))

    # Outils d'analyse facultatifs
    for tool in ("aleapp", "ileapp"):
        checks.append(Check(tool.upper(), Level.OK if runner.available(tool) else Level.INFO,
                            "Disponible." if runner.available(tool) else "Facultatif, absent.",
                            "" if runner.available(tool) else TOOL_HINTS[tool]))

    # Espace disque
    free = shutil.disk_usage(data_dir).free
    level = Level.OK if free > 10 * 1024**3 else Level.WARN
    checks.append(Check("Espace disque (dossier de l'application)", level,
                        f"{free / 1024**3:.1f} Go libres",
                        "" if level is Level.OK else "Prévoyez de l'espace pour les sauvegardes."))
    return checks


def restart_adb_server(runner: CommandRunner) -> str:
    runner.run("adb", ["kill-server"], timeout=15)
    res = runner.run("adb", ["start-server"], timeout=30)
    return "Serveur ADB redémarré." if res.ok else _first_line(res.stderr) or "Échec."


def export_bundle(checks: list[Check], log_lines: list[str], destination: Path) -> Path:
    """Archive de support : diagnostic + journal (déjà expurgés des secrets)."""
    import json

    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("diagnostic.json", json.dumps([asdict(c) for c in checks],
                                                  ensure_ascii=False, indent=2))
        zf.writestr("journal.log", "\n".join(redact(ln) for ln in log_lines))
    return destination
