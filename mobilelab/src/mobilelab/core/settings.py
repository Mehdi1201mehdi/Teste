"""Préférences persistantes (JSON privé dans le dossier de l'application)."""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field
from pathlib import Path

from mobilelab.core.logging_setup import get_logger

log = get_logger("settings")


@dataclass
class Settings:
    tool_paths: dict[str, str] = field(default_factory=dict)  # outil → exécutable choisi
    backup_dir: str = ""
    allow_downloads: bool = False  # consentement aux téléchargements d'outils officiels

    @classmethod
    def load(cls, path: Path) -> Settings:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return cls()
        except (OSError, ValueError) as exc:
            log.warning("Préférences illisibles, valeurs par défaut utilisées : %s", exc)
            return cls()
        known = {k: v for k, v in data.items() if k in cls.__dataclass_fields__}
        return cls(**known)

    def save(self, path: Path) -> None:
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(asdict(self), ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, path)
        if os.name == "posix":
            os.chmod(path, 0o600)
