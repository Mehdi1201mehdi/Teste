"""Gestion d'un appareil Android : applications, capture d'écran, envoi et restauration.

Règles :
- l'envoi n'écrase jamais un fichier existant sur l'appareil (suffixe « (1) », « (2) »…) ;
- la restauration se fait dans un dossier dédié, jamais par-dessus les originaux ;
- chaque fichier restauré est revérifié (SHA-256) contre le manifeste avant envoi ;
- installation et désinstallation sont des actions explicites (confirmées dans l'UI).
"""

from __future__ import annotations

import posixpath
import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path, PurePosixPath

from mobilelab.adapters.base import DeviceManagerAdapter
from mobilelab.core.db import MetadataStore
from mobilelab.core.errors import CommandError, MobileLabError
from mobilelab.core.logging_setup import get_logger
from mobilelab.core.models import Device, Platform
from mobilelab.core.paths import safe_join, sanitize_component, validate_android_path
from mobilelab.services.integrity import read_manifest, sha256_file

log = get_logger("manager")

Progress = Callable[[int, int, str], None]

DEFAULT_PUSH_DIR = "/sdcard/Download/MobileLab"
RESTORE_ROOT = "/sdcard/MobileLab-Restauration"
_SHARED_PREFIXES = ("sdcard/", "storage/emulated/0/", "storage/self/primary/")


@dataclass
class TransferReport:
    done: list[tuple[str, str]] = field(default_factory=list)  # (local, distant)
    skipped: list[tuple[str, str]] = field(default_factory=list)  # (élément, raison)

    @property
    def summary(self) -> str:
        text = f"{len(self.done)} fichier(s) transféré(s)"
        if self.skipped:
            text += f", {len(self.skipped)} ignoré(s)"
        return text + "."


def _require_android(device: Device) -> None:
    if device.platform is not Platform.ANDROID or not device.state.usable:
        raise MobileLabError("Fonction réservée à un appareil Android prêt (débogage autorisé).")


def free_remote_name(adapter: DeviceManagerAdapter, serial: str, remote: str) -> str:
    """Retourne `remote` ou une variante « nom (n).ext » qui n'existe pas encore."""
    if not adapter.remote_exists(serial, remote):
        return remote
    base, ext = posixpath.splitext(remote)
    for i in range(1, 1000):
        candidate = f"{base} ({i}){ext}"
        if not adapter.remote_exists(serial, candidate):
            return candidate
    raise MobileLabError("Trop de fichiers portant le même nom à destination.")


class ManagerService:
    def __init__(self, store: MetadataStore) -> None:
        self.store = store

    # -- applications ----------------------------------------------------------
    def export_apks(self, adapter: DeviceManagerAdapter, device: Device, packages: list[str],
                    destination: Path, progress: Progress | None = None,
                    cancel: threading.Event | None = None) -> TransferReport:
        """Copie les APK d'applications installées (sauvegarde du programme, pas des données)."""
        _require_android(device)
        op = self.store.start_operation("apps.export", device.serial)
        report = TransferReport()
        destination.mkdir(parents=True, exist_ok=True)
        for i, pkg in enumerate(packages, 1):
            if cancel is not None and cancel.is_set():
                break
            if progress:
                progress(i - 1, len(packages), pkg)
            try:
                paths = adapter.apk_paths(device.serial, pkg)
                folder = destination if len(paths) == 1 else destination / sanitize_component(pkg)
                for remote in paths:
                    name = (f"{pkg}.apk" if len(paths) == 1
                            else PurePosixPath(remote).name)
                    local = safe_join(folder, sanitize_component(name))
                    adapter.pull_apk(device.serial, remote, local)
                    report.done.append((str(local), remote))
            except MobileLabError as exc:
                report.skipped.append((pkg, str(exc)))
        if progress:
            progress(len(packages), len(packages), "Terminé")
        self.store.finish_operation(op, "ok" if not report.skipped else "partial", report.summary)
        return report

    def install(self, adapter: DeviceManagerAdapter, device: Device, apks: list[Path]) -> str:
        _require_android(device)
        op = self.store.start_operation("apps.install", device.serial)
        try:
            msg = adapter.install(device.serial, apks)
        except MobileLabError as exc:
            self.store.finish_operation(op, "error", str(exc))
            raise
        self.store.finish_operation(op, "ok", ", ".join(p.name for p in apks))
        return msg

    def uninstall(self, adapter: DeviceManagerAdapter, device: Device, package: str, *,
                  confirm: bool) -> str:
        if not confirm:
            raise MobileLabError("Désinstallation non confirmée.")
        _require_android(device)
        op = self.store.start_operation("apps.uninstall", device.serial)
        try:
            msg = adapter.uninstall(device.serial, package)
        except MobileLabError as exc:
            self.store.finish_operation(op, "error", str(exc))
            raise
        self.store.finish_operation(op, "ok", package)
        return msg

    # -- capture d'écran -------------------------------------------------------
    def screenshot(self, adapter: DeviceManagerAdapter, device: Device,
                   destination: Path) -> Path:
        _require_android(device)
        data = adapter.screenshot(device.serial)
        destination.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        target = destination / f"capture_{sanitize_component(device.serial)}_{stamp}.png"
        target.write_bytes(data)
        log.info("Capture d'écran enregistrée : %s", target)
        return target

    # -- envoi PC → téléphone ----------------------------------------------------
    def push_files(self, adapter: DeviceManagerAdapter, device: Device, files: list[Path],
                   remote_dir: str = DEFAULT_PUSH_DIR, progress: Progress | None = None,
                   cancel: threading.Event | None = None) -> TransferReport:
        _require_android(device)
        remote_dir = validate_android_path(remote_dir).rstrip("/")
        op = self.store.start_operation("files.push", device.serial)
        report = TransferReport()
        for i, local in enumerate(files, 1):
            if cancel is not None and cancel.is_set():
                break
            if progress:
                progress(i - 1, len(files), local.name)
            try:
                remote = free_remote_name(adapter, device.serial,
                                          f"{remote_dir}/{sanitize_component(local.name)}")
                adapter.push(device.serial, local, remote)
                report.done.append((str(local), remote))
            except MobileLabError as exc:
                report.skipped.append((str(local), str(exc)))
        if progress:
            progress(len(files), len(files), "Terminé")
        self.store.finish_operation(op, "ok" if not report.skipped else "partial", report.summary)
        return report

    # -- restauration / migration ---------------------------------------------
    def restore_backup(self, adapter: DeviceManagerAdapter, device: Device, backup_dir: Path,
                       progress: Progress | None = None,
                       cancel: threading.Event | None = None) -> TransferReport:
        """Renvoie le contenu d'une sauvegarde MobileLab vers un appareil Android.

        Destination : /sdcard/MobileLab-Restauration/<nom de la sauvegarde>/… — les fichiers
        d'origine de l'appareil ne sont jamais remplacés. Sert aussi à migrer vers un
        autre téléphone Android.
        """
        _require_android(device)
        manifest = read_manifest(backup_dir)
        if manifest.get("simulated") and not device.simulated:
            raise MobileLabError("Une sauvegarde de simulation ne peut pas être envoyée vers "
                                 "un appareil réel.")
        entries = [e for e in manifest["entries"] if e["status"] == "ok"]
        root = f"{RESTORE_ROOT}/{sanitize_component(backup_dir.name)}"
        op = self.store.start_operation("backup.restore", device.serial)
        report = TransferReport()
        for i, e in enumerate(entries, 1):
            if cancel is not None and cancel.is_set():
                raise CommandError("Restauration annulée par l'utilisateur.")
            rel = e["relative_path"]
            if progress:
                progress(i - 1, len(entries), rel)
            local = backup_dir / "files" / rel
            if not local.is_file() or sha256_file(local) != e["sha256"]:
                report.skipped.append((rel, "fichier absent ou altéré dans la sauvegarde"))
                continue
            short = next((rel[len(p):] for p in _SHARED_PREFIXES if rel.startswith(p)), rel)
            try:
                remote = free_remote_name(adapter, device.serial, f"{root}/{short}")
                adapter.push(device.serial, local, remote)
                report.done.append((str(local), remote))
            except MobileLabError as exc:
                report.skipped.append((rel, str(exc)))
        if progress:
            progress(len(entries), len(entries), "Terminé")
        self.store.finish_operation(op, "ok" if not report.skipped else "partial", report.summary)
        return report


def default_capture_dir() -> Path:
    pictures = Path.home() / "Pictures"
    return (pictures if pictures.is_dir() else Path.home()) / "MobileLab"
