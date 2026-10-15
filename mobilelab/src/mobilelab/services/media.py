"""Analyse de médias : doublons exacts et métadonnées photo (EXIF) en lecture seule."""

from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from pathlib import Path

from mobilelab.core.logging_setup import get_logger
from mobilelab.services.integrity import sha256_file

log = get_logger("media")

Progress = Callable[[int, int, str], None]

IMAGE_KINDS = {"jpeg", "png", "heic", "heif", "gif"}
VIDEO_KINDS = {"mp4", "mov"}

# Étiquettes EXIF standard (CIPA DC-008)
_TAG_MODEL = 0x0110
_TAG_DATETIME = 0x0132
_IFD_EXIF = 0x8769
_IFD_GPS = 0x8825
_TAG_DATETIME_ORIGINAL = 0x9003


@dataclass
class DuplicateGroup:
    sha256: str
    size: int
    paths: list[str]

    @property
    def wasted(self) -> int:
        return self.size * (len(self.paths) - 1)


@dataclass
class PhotoSummary:
    images: int = 0
    videos: int = 0
    with_exif: int = 0
    with_gps: int = 0
    by_year: Counter = field(default_factory=Counter)
    by_camera: Counter = field(default_factory=Counter)
    exif_available: bool = True


def find_duplicates(files: Iterable[tuple[str, Path]], progress: Progress | None = None
                    ) -> list[DuplicateGroup]:
    """Doublons exacts : regroupement par taille, puis confirmation par SHA-256."""
    by_size: dict[int, list[tuple[str, Path]]] = defaultdict(list)
    for label, path in files:
        try:
            by_size[path.stat().st_size].append((label, path))
        except OSError:
            continue
    candidates = [(s, items) for s, items in by_size.items() if len(items) > 1 and s > 0]
    total = sum(len(items) for _s, items in candidates)
    done = 0
    groups: list[DuplicateGroup] = []
    for size, items in candidates:
        by_hash: dict[str, list[str]] = defaultdict(list)
        for label, path in items:
            done += 1
            if progress:
                progress(done, total, label)
            try:
                by_hash[sha256_file(path)].append(label)
            except OSError:
                continue
        groups += [DuplicateGroup(h, size, sorted(p)) for h, p in by_hash.items() if len(p) > 1]
    return sorted(groups, key=lambda g: g.wasted, reverse=True)


def photo_summary(files: Iterable[tuple[str, Path, str]]) -> PhotoSummary:
    """Résumé des photos/vidéos ; `files` = (libellé, chemin local, type détecté)."""
    summary = PhotoSummary()
    try:
        from PIL import Image  # facultatif
    except ImportError:
        Image = None  # noqa: N806
        summary.exif_available = False
    for _label, path, kind in files:
        if kind in VIDEO_KINDS:
            summary.videos += 1
            continue
        if kind not in IMAGE_KINDS:
            continue
        summary.images += 1
        if Image is None or kind not in {"jpeg", "png"}:
            continue
        try:
            with Image.open(path) as img:
                exif = img.getexif()
                if not exif:
                    continue
                summary.with_exif += 1
                sub = exif.get_ifd(_IFD_EXIF)
                date = str(sub.get(_TAG_DATETIME_ORIGINAL) or exif.get(_TAG_DATETIME) or "")
                if len(date) >= 4 and date[:4].isdigit():
                    summary.by_year[date[:4]] += 1
                model = str(exif.get(_TAG_MODEL) or "").strip("\x00 ").strip()
                if model:
                    summary.by_camera[model] += 1
                if exif.get_ifd(_IFD_GPS):
                    summary.with_gps += 1
        except Exception as exc:  # noqa: BLE001 - fichier corrompu : on continue
            log.debug("EXIF illisible pour %s : %s", path.name, exc)
    return summary
