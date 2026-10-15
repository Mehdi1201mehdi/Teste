"""Emplacements de l'application et validation stricte des chemins.

Toute donnée issue de l'appareil ou de l'utilisateur passe par ces fonctions
avant d'atteindre le système de fichiers ou un outil externe.
"""

from __future__ import annotations

import os
import posixpath
import re
import sys
from pathlib import Path, PurePosixPath

from mobilelab.core.errors import UnsafePathError

# Racines Android accessibles sans root ni contournement : stockage partagé.
ANDROID_ALLOWED_ROOTS = ("/sdcard", "/storage/emulated", "/storage/self")

_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")
_WINDOWS_RESERVED = re.compile(r'[<>:"|?*\\]')
_WINDOWS_RESERVED_NAMES = {
    "CON", "PRN", "AUX", "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
}


def app_data_dir() -> Path:
    """Dossier privé de l'application (surcharge possible via MOBILELAB_HOME)."""
    override = os.environ.get("MOBILELAB_HOME")
    if override:
        base = Path(override)
    elif sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local")) / "MobileLab"
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support" / "MobileLab"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share")) / "mobilelab"
    return ensure_private_dir(base)


def ensure_private_dir(path: Path) -> Path:
    """Crée le dossier si besoin et le restreint au seul utilisateur (POSIX)."""
    path.mkdir(parents=True, exist_ok=True)
    if os.name == "posix":
        os.chmod(path, 0o700)
    return path


def validate_android_path(path: str) -> str:
    """Valide un chemin distant Android et le normalise.

    Refuse : chemin relatif, caractères de contrôle, remontée « .. »,
    et tout emplacement hors du stockage partagé de l'utilisateur.
    """
    if not isinstance(path, str) or not path:
        raise UnsafePathError("Chemin distant vide.")
    if _CONTROL_CHARS.search(path):
        raise UnsafePathError("Chemin distant invalide (caractère de contrôle).")
    if not path.startswith("/"):
        raise UnsafePathError("Le chemin distant doit être absolu.", "Exemple : /sdcard/DCIM")
    if ".." in PurePosixPath(path).parts:
        raise UnsafePathError("Remontée de dossier (..) interdite.")
    normalized = posixpath.normpath(path)
    if not any(normalized == r or normalized.startswith(r + "/") for r in ANDROID_ALLOWED_ROOTS):
        raise UnsafePathError(
            f"Emplacement non autorisé : {normalized}",
            "Seul le stockage partagé (/sdcard, /storage/emulated) est accessible.",
        )
    return normalized


def sanitize_component(name: str) -> str:
    """Rend un nom de fichier sûr sur Windows, macOS et Linux."""
    cleaned = _CONTROL_CHARS.sub("_", name)
    cleaned = _WINDOWS_RESERVED.sub("_", cleaned).strip(" .")
    if not cleaned or cleaned in {".", ".."}:
        cleaned = "_"
    if cleaned.split(".")[0].upper() in _WINDOWS_RESERVED_NAMES:
        cleaned = "_" + cleaned
    return cleaned[:200]


def safe_join(base: Path, relative: str) -> Path:
    """Joint un chemin relatif (style POSIX) à `base` sans jamais en sortir."""
    parts = [sanitize_component(p) for p in PurePosixPath(relative).parts if p not in ("/", "")]
    if any(p == ".." for p in PurePosixPath(relative).parts):
        raise UnsafePathError("Remontée de dossier (..) interdite.")
    target = base.joinpath(*parts) if parts else base
    base_resolved = base.resolve()
    target_resolved = target.resolve()
    if target_resolved != base_resolved and base_resolved not in target_resolved.parents:
        raise UnsafePathError("Le chemin cible sort du dossier de destination.")
    return target
