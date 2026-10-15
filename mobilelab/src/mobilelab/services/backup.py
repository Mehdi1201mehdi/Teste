"""Sauvegardes : Android fichier par fichier (ADB), iOS complète (idevicebackup2).

Garanties :
- destination neuve (jamais d'écrasement) et espace disque vérifié avant copie ;
- empreinte SHA-256 de chaque fichier + manifeste scellé ;
- les erreurs par fichier n'interrompent pas la sauvegarde et sont tracées ;
- suppression uniquement d'un dossier reconnu comme sauvegarde, avec confirmation explicite.
"""

from __future__ import annotations

import shutil
import threading
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path

from mobilelab import __version__
from mobilelab.adapters.base import FileTransferAdapter, FullBackupAdapter
from mobilelab.core.db import BackupRecord, MetadataStore, utcnow
from mobilelab.core.errors import (
    CommandError,
    ConfirmationRequiredError,
    InsufficientSpaceError,
    MobileLabError,
    UnsafePathError,
)
from mobilelab.core.logging_setup import get_logger
from mobilelab.core.models import BackupEntry, BackupResult, Device, Platform, RemoteFile
from mobilelab.core.paths import safe_join, sanitize_component, validate_android_path
from mobilelab.services.integrity import is_mobilelab_backup, sha256_file, write_manifest

log = get_logger("backup")

Progress = Callable[[int, int, str], None]  # (fait, total, message)

DEFAULT_ANDROID_FOLDERS = {
    "Photos et vidéos (DCIM)": "/sdcard/DCIM",
    "Images": "/sdcard/Pictures",
    "Téléchargements": "/sdcard/Download",
    "Documents": "/sdcard/Documents",
    "Musique": "/sdcard/Music",
    "Films": "/sdcard/Movies",
}

SAFETY_MARGIN = 256 * 1024 * 1024  # 256 Mo gardés libres


def check_space(destination: Path, required: int) -> None:
    probe = destination
    while not probe.exists():
        probe = probe.parent
    free = shutil.disk_usage(probe).free
    if free < required + SAFETY_MARGIN:
        raise InsufficientSpaceError(
            f"Espace insuffisant : {required / 1e6:.0f} Mo nécessaires, "
            f"{free / 1e6:.0f} Mo libres.",
            "Choisissez une autre destination ou libérez de l'espace.",
        )


def new_backup_dir(parent: Path, device: Device) -> Path:
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    target = parent / f"{sanitize_component(device.serial)}_{stamp}"
    if target.exists():
        raise UnsafePathError(f"La destination existe déjà : {target}")
    return target


class BackupService:
    def __init__(self, store: MetadataStore) -> None:
        self.store = store

    # -- Android ---------------------------------------------------------------
    def plan_android(self, adapter: FileTransferAdapter, device: Device,
                     roots: list[str]) -> list[RemoteFile]:
        files: dict[str, RemoteFile] = {}
        for root in roots:
            for f in adapter.list_files(device.serial, validate_android_path(root)):
                files[f.path] = f
        return sorted(files.values(), key=lambda f: f.path)

    def backup_android(
        self,
        adapter: FileTransferAdapter,
        device: Device,
        roots: list[str],
        destination_parent: Path,
        progress: Progress | None = None,
        cancel: threading.Event | None = None,
    ) -> BackupResult:
        if device.platform is not Platform.ANDROID or not device.state.usable:
            raise MobileLabError("Appareil Android non prêt.")
        op = self.store.start_operation("backup.android", device.serial)
        try:
            files = self.plan_android(adapter, device, roots)
            total = sum(f.size for f in files)
            check_space(destination_parent, total)
            backup_dir = new_backup_dir(destination_parent, device)
            files_dir = backup_dir / "files"
            files_dir.mkdir(parents=True)
            result = BackupResult(uuid.uuid4().hex, backup_dir, device.serial,
                                  simulated=device.simulated)
            for i, rf in enumerate(files, 1):
                if cancel is not None and cancel.is_set():
                    raise CommandError("Sauvegarde annulée par l'utilisateur.")
                rel = rf.path.lstrip("/")
                if progress:
                    progress(i - 1, len(files), rf.path)
                result.entries.append(self._copy_one(adapter, device, rf, files_dir, rel))
            if progress:
                progress(len(files), len(files), "Écriture du manifeste")
            self._finalize(result, device, {"roots": roots})
            self.store.finish_operation(
                op, "ok" if not result.error_count else "partial",
                f"{result.ok_count} fichier(s), {result.error_count} erreur(s)",
            )
            return result
        except Exception as exc:
            self.store.finish_operation(op, "error", str(exc))
            raise

    def _copy_one(self, adapter: FileTransferAdapter, device: Device, rf: RemoteFile,
                  files_dir: Path, rel: str) -> BackupEntry:
        try:
            local = safe_join(files_dir, rel)
            adapter.pull(device.serial, rf.path, local)
            size = local.stat().st_size
            entry = BackupEntry(rf.path, local.relative_to(files_dir).as_posix(), size,
                                sha256_file(local))
            if size != rf.size:
                entry.status, entry.error = "error", f"taille attendue {rf.size}, reçue {size}"
            return entry
        except MobileLabError as exc:
            log.warning("Échec de copie : %s", exc)
            return BackupEntry(rf.path, rel, 0, "", "error", str(exc))

    # -- iOS -------------------------------------------------------------------
    def backup_ios(
        self,
        adapter: FullBackupAdapter,
        device: Device,
        destination_parent: Path,
        on_line: Callable[[str], None],
        cancel: threading.Event | None = None,
    ) -> BackupResult:
        if device.platform is not Platform.IOS or not device.state.usable:
            raise MobileLabError("Appareil Apple non prêt.")
        op = self.store.start_operation("backup.ios", device.serial)
        try:
            # Taille inconnue à l'avance : on exige au moins 5 Go libres.
            check_space(destination_parent, 5 * 1024**3 if not device.simulated else 0)
            backup_dir = new_backup_dir(destination_parent, device)
            native_dir = backup_dir / "files"
            adapter.create_backup(device.serial, native_dir, on_line, cancel)
            result = BackupResult(uuid.uuid4().hex, backup_dir, device.serial,
                                  simulated=device.simulated)
            for f in sorted(p for p in native_dir.rglob("*") if p.is_file()):
                rel = f.relative_to(native_dir).as_posix()
                result.entries.append(BackupEntry(f"idevicebackup2:{rel}", rel,
                                                  f.stat().st_size, sha256_file(f)))
            self._finalize(result, device, {"method": "idevicebackup2 --full"})
            self.store.finish_operation(op, "ok", f"{result.ok_count} fichier(s)")
            return result
        except Exception as exc:
            self.store.finish_operation(op, "error", str(exc))
            raise

    # -- commun ----------------------------------------------------------------
    def _finalize(self, result: BackupResult, device: Device, extra: dict) -> None:
        created = utcnow()
        header = {
            "backup_id": result.backup_id,
            "created_at": created,
            "tool": f"MobileLab {__version__}",
            "simulated": result.simulated,
            "device": {
                "serial": device.serial, "platform": device.platform.value,
                "model": device.model, "manufacturer": device.manufacturer,
                "os_version": device.os_version,
            },
            **extra,
        }
        write_manifest(result.destination, header, result.entries)
        self.store.add_backup(
            BackupRecord(result.backup_id, device.serial, device.platform.value,
                         str(result.destination), created, result.ok_count,
                         result.total_bytes, result.simulated),
            extra,
        )
        log.info("Sauvegarde terminée : %d fichier(s), %d erreur(s) → %s",
                 result.ok_count, result.error_count, result.destination)

    def delete_backup(self, backup_dir: Path, backup_id: str | None, *, confirm: bool) -> None:
        """Supprime une sauvegarde locale. Exige `confirm=True` et un manifeste valide."""
        if not confirm:
            raise ConfirmationRequiredError("Suppression non confirmée.")
        if not is_mobilelab_backup(backup_dir):
            raise UnsafePathError("Ce dossier n'est pas une sauvegarde MobileLab : refus.")
        shutil.rmtree(backup_dir)
        if backup_id:
            self.store.forget_backup(backup_id)
        log.info("Sauvegarde supprimée : %s", backup_dir)
