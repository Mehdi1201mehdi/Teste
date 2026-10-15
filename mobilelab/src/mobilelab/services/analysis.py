"""Analyse de sauvegardes et dossiers locaux — en lecture seule.

Les sources ne sont jamais modifiées : les bases SQLite sont copiées dans un dossier
temporaire avant ouverture (une base en mode WAL pourrait sinon être réécrite).
"""

from __future__ import annotations

import io
import os
import plistlib
import shutil
import sqlite3
import tarfile
import tempfile
import zlib
from collections.abc import Iterator
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path

from mobilelab.core.errors import EncryptedBackupError, MobileLabError, UnsafePathError
from mobilelab.core.logging_setup import get_logger
from mobilelab.core.paths import safe_join
from mobilelab.services.integrity import is_mobilelab_backup

log = get_logger("analysis")

MAX_INVENTORY = 500_000


class SourceKind(str, Enum):
    MOBILELAB = "Sauvegarde MobileLab"
    IOS_BACKUP = "Sauvegarde iOS (format iTunes/Finder)"
    ANDROID_AB = "Sauvegarde Android (adb backup .ab)"
    FOLDER = "Dossier"
    FILE = "Fichier"


# -- détection de type par signature (« magic bytes ») ---------------------------
_SIGNATURES: list[tuple[bytes, int, str]] = [
    (b"SQLite format 3\x00", 0, "sqlite"),
    (b"\xff\xd8\xff", 0, "jpeg"),
    (b"\x89PNG\r\n\x1a\n", 0, "png"),
    (b"GIF8", 0, "gif"),
    (b"%PDF", 0, "pdf"),
    (b"PK\x03\x04", 0, "zip"),
    (b"bplist00", 0, "plist"),
    (b"ID3", 0, "mp3"),
    (b"OggS", 0, "ogg"),
    (b"RIFF", 0, "riff"),
    (b"ANDROID BACKUP\n", 0, "android-backup"),
    (b"MOBILELAB-SIMULATION", 0, "simulation"),
]
_FTYP = {b"heic": "heic", b"heix": "heic", b"mif1": "heif", b"qt  ": "mov", b"M4A ": "m4a"}


def detect_type(path: Path) -> str:
    try:
        with path.open("rb") as fh:
            head = fh.read(32)
    except OSError:
        return "illisible"
    for sig, off, name in _SIGNATURES:
        if head[off:off + len(sig)] == sig:
            return name
    if head[4:8] == b"ftyp":
        return _FTYP.get(head[8:12], "mp4")
    if head.lstrip().startswith(b"<?xml") and b"plist" in head:
        return "plist"
    if head and all(32 <= b < 127 or b in (9, 10, 13) for b in head):
        return "texte"
    return "inconnu"


@dataclass(frozen=True)
class FileRecord:
    relative_path: str
    size: int
    mtime: float
    kind: str
    provenance: str  # d'où vient l'information (chemin source, domaine iOS…)


@dataclass
class SourceSummary:
    path: Path
    kind: SourceKind
    encrypted: bool = False
    details: dict[str, str] = field(default_factory=dict)


def identify(path: Path) -> SourceSummary:
    if path.is_file():
        if detect_type(path) == "android-backup":
            header = read_ab_header(path)
            return SourceSummary(path, SourceKind.ANDROID_AB, header["encryption"] != "none",
                                 {"Version": header["version"],
                                  "Compressé": header["compressed"],
                                  "Chiffrement": header["encryption"]})
        return SourceSummary(path, SourceKind.FILE, details={"Type": detect_type(path)})
    if is_mobilelab_backup(path):
        return SourceSummary(path, SourceKind.MOBILELAB)
    ios_root = find_ios_backup_root(path)
    if ios_root is not None:
        return ios_summary(ios_root)
    return SourceSummary(path, SourceKind.FOLDER)


def inventory(root: Path) -> Iterator[FileRecord]:
    """Parcourt un dossier sans suivre les liens symboliques."""
    count = 0
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        dirnames.sort()
        for name in sorted(filenames):
            p = Path(dirpath) / name
            if p.is_symlink():
                continue
            try:
                st = p.stat()
            except OSError:
                continue
            count += 1
            if count > MAX_INVENTORY:
                log.warning("Inventaire tronqué à %d fichiers.", MAX_INVENTORY)
                return
            yield FileRecord(p.relative_to(root).as_posix(), st.st_size, st.st_mtime,
                             detect_type(p), str(p))


# -- SQLite ---------------------------------------------------------------------
@dataclass
class SqliteTable:
    name: str
    columns: list[str]
    row_count: int


@dataclass
class SqliteReport:
    path: Path
    tables: list[SqliteTable]
    page_size: int
    page_count: int
    freelist_count: int
    journal_mode: str
    has_wal: bool

    @property
    def free_ratio(self) -> float:
        return self.freelist_count / self.page_count if self.page_count else 0.0


def _quote_ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


class _ReadOnlyCopy:
    """Copie la base (et ses fichiers -wal/-shm) dans un dossier temporaire privé."""

    def __init__(self, db: Path) -> None:
        self.db = db
        self._tmp: tempfile.TemporaryDirectory[str] | None = None

    def __enter__(self) -> sqlite3.Connection:
        self._tmp = tempfile.TemporaryDirectory(prefix="mobilelab-")
        target = Path(self._tmp.name) / "db.sqlite"
        shutil.copy2(self.db, target)
        for suffix in ("-wal", "-shm"):
            side = self.db.with_name(self.db.name + suffix)
            if side.exists():
                shutil.copy2(side, target.with_name(target.name + suffix))
        self.conn = sqlite3.connect(f"file:{target.as_posix()}?mode=ro", uri=True)
        return self.conn

    def __exit__(self, *exc: object) -> None:
        self.conn.close()
        assert self._tmp is not None
        self._tmp.cleanup()


def inspect_sqlite(db: Path) -> SqliteReport:
    if detect_type(db) != "sqlite":
        raise MobileLabError(f"{db.name} n'est pas une base SQLite.")
    with _ReadOnlyCopy(db) as conn:
        try:
            names = [r[0] for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
            tables = []
            for n in names:
                cols = [r[1] for r in conn.execute(f"PRAGMA table_info({_quote_ident(n)})")]
                try:
                    q = f"SELECT COUNT(*) FROM {_quote_ident(n)}"  # noqa: S608 - identifiant échappé
                    count = conn.execute(q).fetchone()[0]
                except sqlite3.DatabaseError:
                    count = -1  # table virtuelle sans module, etc.
                tables.append(SqliteTable(n, cols, count))
            pragma = lambda p: conn.execute(f"PRAGMA {p}").fetchone()[0]  # noqa: E731
            return SqliteReport(db, tables, pragma("page_size"), pragma("page_count"),
                                pragma("freelist_count"), str(pragma("journal_mode")),
                                db.with_name(db.name + "-wal").exists())
        except sqlite3.DatabaseError as exc:
            raise MobileLabError(f"Base illisible ({exc}).",
                                 "Elle est peut-être chiffrée ou corrompue.") from exc


def preview_table(db: Path, table: str, limit: int = 200) -> tuple[list[str], list[tuple]]:
    with _ReadOnlyCopy(db) as conn:
        known = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if table not in known:
            raise UnsafePathError(f"Table inconnue : {table}")
        q = f"SELECT * FROM {_quote_ident(table)} LIMIT ?"  # noqa: S608 - table validée + échappée
        cur = conn.execute(q, (int(limit),))
        cols = [d[0] for d in cur.description]
        rows = [tuple(_display(v) for v in row) for row in cur.fetchall()]
        return cols, rows


def _display(value: object) -> object:
    if isinstance(value, bytes):
        return f"<{len(value)} octets>"
    return value


# -- iOS (format de sauvegarde iTunes/Finder) -----------------------------------
def find_ios_backup_root(path: Path) -> Path | None:
    """Le dossier contenant Manifest.plist (éventuellement un niveau plus bas : <UDID>/)."""
    if (path / "Manifest.plist").is_file():
        return path
    for sub in (path, path / "files"):
        if sub.is_dir():
            for child in sorted(sub.iterdir()):
                if child.is_dir() and (child / "Manifest.plist").is_file():
                    return child
    return None


def ios_summary(root: Path) -> SourceSummary:
    with (root / "Manifest.plist").open("rb") as fh:
        manifest = plistlib.load(fh)
    details: dict[str, str] = {}
    info_path = root / "Info.plist"
    if info_path.is_file():
        with info_path.open("rb") as fh:
            info = plistlib.load(fh)
        for key, label in (("Product Type", "Modèle"), ("Product Version", "Version iOS"),
                           ("Last Backup Date", "Date de sauvegarde")):
            if key in info:
                details[label] = str(info[key])
    encrypted = bool(manifest.get("IsEncrypted", False))
    details["Chiffrée"] = "oui" if encrypted else "non"
    return SourceSummary(root, SourceKind.IOS_BACKUP, encrypted, details)


@dataclass(frozen=True)
class IosFile:
    file_id: str
    domain: str
    relative_path: str


def ios_files(root: Path) -> list[IosFile]:
    summary = ios_summary(root)
    if summary.encrypted:
        raise EncryptedBackupError(
            "Sauvegarde iOS chiffrée : son contenu n'est pas lisible.",
            "MobileLab ne contourne pas le chiffrement. Le propriétaire peut créer une "
            "sauvegarde non chiffrée depuis Finder/iTunes s'il le souhaite.",
        )
    db = root / "Manifest.db"
    if not db.is_file():
        raise MobileLabError("Manifest.db absent : sauvegarde incomplète ou ancien format.")
    with _ReadOnlyCopy(db) as conn:
        rows = conn.execute(
            "SELECT fileID, domain, relativePath FROM Files WHERE flags = 1 "
            "ORDER BY domain, relativePath").fetchall()
    return [IosFile(*r) for r in rows]


def extract_ios_file(root: Path, item: IosFile, destination: Path) -> Path:
    if not all(c in "0123456789abcdef" for c in item.file_id) or len(item.file_id) != 40:
        raise UnsafePathError("Identifiant de fichier iOS invalide.")
    src = root / item.file_id[:2] / item.file_id
    if not src.is_file():
        raise MobileLabError(f"Fichier absent de la sauvegarde : {item.relative_path}")
    target = safe_join(destination, f"{item.domain}/{item.relative_path}")
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, target)
    return target


# -- Android : adb backup (.ab) -------------------------------------------------
def read_ab_header(path: Path) -> dict[str, str]:
    with path.open("rb") as fh:
        lines = [fh.readline().decode("ascii", "replace").strip() for _ in range(4)]
    if lines[0] != "ANDROID BACKUP":
        raise MobileLabError("Fichier .ab invalide.")
    return {"version": lines[1], "compressed": lines[2], "encryption": lines[3]}


class _ZlibReader(io.RawIOBase):
    """Flux décompressé à la volée (évite de charger toute la sauvegarde en mémoire)."""

    def __init__(self, fh: io.BufferedReader) -> None:
        self._fh = fh
        self._z = zlib.decompressobj()
        self._buf = b""

    def readable(self) -> bool:
        return True

    def readinto(self, b: bytearray) -> int:  # type: ignore[override]
        while len(self._buf) < len(b):
            chunk = self._fh.read(65536)
            if not chunk:
                self._buf += self._z.flush()
                break
            self._buf += self._z.decompress(chunk)
        n = min(len(b), len(self._buf))
        b[:n] = self._buf[:n]
        self._buf = self._buf[n:]
        return n


def _open_ab_tar(path: Path) -> tuple[io.BufferedReader, tarfile.TarFile]:
    header = read_ab_header(path)
    if header["encryption"] != "none":
        raise EncryptedBackupError("Sauvegarde .ab chiffrée : contenu non lisible.",
                                   "MobileLab ne contourne pas le chiffrement.")
    fh = path.open("rb")
    for _ in range(4):
        fh.readline()
    stream = io.BufferedReader(_ZlibReader(fh)) if header["compressed"] == "1" else fh
    return fh, tarfile.open(fileobj=stream, mode="r|")


def ab_members(path: Path) -> list[FileRecord]:
    fh, tar = _open_ab_tar(path)
    try:
        return [FileRecord(m.name, m.size, m.mtime, "archive", f"{path.name}:{m.name}")
                for m in tar if m.isfile()]
    finally:
        tar.close()
        fh.close()


def extract_ab(path: Path, destination: Path) -> tuple[int, int]:
    """Extrait une sauvegarde .ab non chiffrée → (extraits, ignorés).

    Le filtre « data » de tarfile refuse chemins absolus, remontées et liens dangereux ;
    ces membres sont ignorés et journalisés sans interrompre l'extraction.
    """
    destination.mkdir(parents=True, exist_ok=True)
    fh, tar = _open_ab_tar(path)
    count = skipped = 0
    try:
        for member in tar:
            if not member.isfile():
                continue
            try:
                tar.extract(member, destination, filter="data")
                count += 1
            except tarfile.FilterError as exc:
                skipped += 1
                log.warning("Membre ignoré (chemin dangereux) : %s", exc)
    finally:
        tar.close()
        fh.close()
    return count, skipped
