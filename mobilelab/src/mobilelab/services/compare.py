"""Comparaison de deux sauvegardes MobileLab (module expérimental)."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from mobilelab.services.integrity import read_manifest


@dataclass
class BackupDiff:
    added: list[str] = field(default_factory=list)
    removed: list[str] = field(default_factory=list)
    modified: list[str] = field(default_factory=list)
    unchanged: int = 0


def compare_backups(old: Path, new: Path) -> BackupDiff:
    def index(p: Path) -> dict[str, str]:
        return {e["relative_path"]: e["sha256"]
                for e in read_manifest(p)["entries"] if e["status"] == "ok"}

    a, b = index(old), index(new)
    diff = BackupDiff()
    diff.added = sorted(set(b) - set(a))
    diff.removed = sorted(set(a) - set(b))
    for path in sorted(set(a) & set(b)):
        if a[path] != b[path]:
            diff.modified.append(path)
        else:
            diff.unchanged += 1
    return diff
