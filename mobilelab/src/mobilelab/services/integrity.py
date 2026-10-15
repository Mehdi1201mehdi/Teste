"""Empreintes et manifestes de sauvegarde (format `mobilelab-backup/1`)."""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import asdict, dataclass, field
from pathlib import Path

from mobilelab.core.models import BackupEntry

MANIFEST_NAME = "manifest.json"
MANIFEST_FORMAT = "mobilelab-backup/1"
_CHUNK = 1024 * 1024


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        while chunk := fh.read(_CHUNK):
            h.update(chunk)
    return h.hexdigest()


def write_manifest(backup_dir: Path, header: dict, entries: list[BackupEntry]) -> Path:
    data = {"format": MANIFEST_FORMAT, **header, "entries": [asdict(e) for e in entries]}
    path = backup_dir / MANIFEST_NAME
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)  # écriture atomique
    (backup_dir / "manifest.sha256").write_text(f"{sha256_file(path)}  {MANIFEST_NAME}\n")
    return path


def read_manifest(backup_dir: Path) -> dict:
    path = backup_dir / MANIFEST_NAME
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("format") != MANIFEST_FORMAT:
        raise ValueError("Manifeste MobileLab non reconnu.")
    return data


def is_mobilelab_backup(path: Path) -> bool:
    try:
        read_manifest(path)
        return True
    except (OSError, ValueError):
        return False


@dataclass
class VerificationReport:
    checked: int = 0
    ok: int = 0
    missing: list[str] = field(default_factory=list)
    mismatched: list[str] = field(default_factory=list)
    manifest_tampered: bool = False

    @property
    def valid(self) -> bool:
        return not (self.missing or self.mismatched or self.manifest_tampered)


def verify_backup(backup_dir: Path) -> VerificationReport:
    report = VerificationReport()
    seal = backup_dir / "manifest.sha256"
    if seal.exists():
        expected = seal.read_text().split()[0]
        report.manifest_tampered = expected != sha256_file(backup_dir / MANIFEST_NAME)
    data = read_manifest(backup_dir)
    for entry in data["entries"]:
        if entry["status"] != "ok":
            continue
        report.checked += 1
        f = backup_dir / "files" / entry["relative_path"]
        if not f.is_file():
            report.missing.append(entry["relative_path"])
        elif sha256_file(f) != entry["sha256"]:
            report.mismatched.append(entry["relative_path"])
        else:
            report.ok += 1
    return report
