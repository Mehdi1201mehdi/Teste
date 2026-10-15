import io
import json
import plistlib
import sqlite3
import tarfile
import zlib
from pathlib import Path

import pytest

from mobilelab.core.errors import EncryptedBackupError, UnsafePathError
from mobilelab.services import analysis
from mobilelab.services.analysis import SourceKind
from mobilelab.services.report import export_report
from tests.conftest import make_sqlite


def test_detect_type(tmp_path: Path):
    samples = {"a.db": b"SQLite format 3\x00" + b"\0" * 20, "b.jpg": b"\xff\xd8\xff\xe0",
               "c.heic": b"\0\0\0\x18ftypheic\0\0", "d.txt": b"bonjour\n", "e.bin": b"\x00\x9f\x01"}
    for name, data in samples.items():
        (tmp_path / name).write_bytes(data)
    kinds = {r.relative_path: r.kind for r in analysis.inventory(tmp_path)}
    assert kinds == {"a.db": "sqlite", "b.jpg": "jpeg", "c.heic": "heic", "d.txt": "texte",
                     "e.bin": "inconnu"}


def test_sqlite_read_only_and_preview(tmp_path: Path):
    db = make_sqlite(tmp_path / "sms.db", rows=5)
    before = db.read_bytes()
    rep = analysis.inspect_sqlite(db)
    assert [(t.name, t.row_count) for t in rep.tables] == [("messages", 5)]
    cols, rows = analysis.preview_table(db, "messages", limit=2)
    assert cols == ["id", "body", "blob"] and rows[0][2] == "<2 octets>"
    assert db.read_bytes() == before  # source intacte
    with pytest.raises(UnsafePathError):
        analysis.preview_table(db, "messages; DROP TABLE messages")


def test_sqlite_freelist_reported(tmp_path: Path):
    db = tmp_path / "x.db"
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE t(v TEXT)")
    conn.executemany("INSERT INTO t VALUES (?)", [("x" * 2000,) for _ in range(200)])
    conn.commit()
    conn.execute("DELETE FROM t")
    conn.commit()
    conn.close()
    assert analysis.inspect_sqlite(db).freelist_count > 0


def _ios_backup(root: Path, encrypted: bool) -> Path:
    root.mkdir(parents=True)
    (root / "Manifest.plist").write_bytes(plistlib.dumps({"IsEncrypted": encrypted}))
    (root / "Info.plist").write_bytes(plistlib.dumps({"Product Type": "iPhone14,5",
                                                      "Product Version": "18.0"}))
    fid = "3d0d7e5fb2ce288813306e4d4636395e047a3d28"
    (root / fid[:2]).mkdir()
    (root / fid[:2] / fid).write_bytes(b"SQLite format 3\x00fake")
    conn = sqlite3.connect(root / "Manifest.db")
    conn.execute("CREATE TABLE Files (fileID TEXT, domain TEXT, relativePath TEXT, flags INT, file BLOB)")
    conn.execute("INSERT INTO Files VALUES (?, 'HomeDomain', 'Library/SMS/sms.db', 1, NULL)", (fid,))
    conn.execute("INSERT INTO Files VALUES ('dir', 'HomeDomain', 'Library', 2, NULL)")
    conn.commit()
    conn.close()
    return root


def test_ios_backup_unencrypted(tmp_path: Path):
    root = _ios_backup(tmp_path / "bk" / "00008110-AAAA", encrypted=False)
    summary = analysis.identify(tmp_path / "bk")
    assert summary.kind is SourceKind.IOS_BACKUP and not summary.encrypted
    assert summary.details["Modèle"] == "iPhone14,5"
    [item] = analysis.ios_files(root)
    out = analysis.extract_ios_file(root, item, tmp_path / "extract")
    assert out == tmp_path / "extract" / "HomeDomain" / "Library" / "SMS" / "sms.db"


def test_ios_backup_encrypted_is_not_bypassed(tmp_path: Path):
    root = _ios_backup(tmp_path / "enc", encrypted=True)
    assert analysis.identify(root).encrypted
    with pytest.raises(EncryptedBackupError):
        analysis.ios_files(root)


def _ab(path: Path, encryption="none", compressed=True) -> Path:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as tar:
        data = b"hello"
        info = tarfile.TarInfo("apps/com.example/f/note.txt")
        info.size = len(data)
        tar.addfile(info, io.BytesIO(data))
        evil = tarfile.TarInfo("../../evil.txt")
        evil.size = 1
        tar.addfile(evil, io.BytesIO(b"x"))
    payload = zlib.compress(buf.getvalue()) if compressed else buf.getvalue()
    path.write_bytes(f"ANDROID BACKUP\n5\n{int(compressed)}\n{encryption}\n".encode() + payload)
    return path


def test_android_ab_listing_and_safe_extract(tmp_path: Path):
    ab = _ab(tmp_path / "backup.ab")
    summary = analysis.identify(ab)
    assert summary.kind is SourceKind.ANDROID_AB and not summary.encrypted
    names = [r.relative_path for r in analysis.ab_members(ab)]
    assert "apps/com.example/f/note.txt" in names
    out = tmp_path / "out"
    assert analysis.extract_ab(ab, out) == (1, 1)  # « ../../evil.txt » ignoré
    assert not (tmp_path / "evil.txt").exists()
    assert (out / "apps/com.example/f/note.txt").read_bytes() == b"hello"


def test_android_ab_encrypted(tmp_path: Path):
    ab = _ab(tmp_path / "enc.ab", encryption="AES-256")
    assert analysis.identify(ab).encrypted
    with pytest.raises(EncryptedBackupError):
        analysis.ab_members(ab)


@pytest.mark.parametrize("ext", ["json", "csv", "html"])
def test_reports(tmp_path: Path, ext):
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "=cmd|x.txt").write_text("a")
    (tmp_path / "src" / "<script>.txt").write_text("b")
    summary = analysis.identify(tmp_path / "src")
    out = export_report(summary, analysis.inventory(tmp_path / "src"), tmp_path / f"r.{ext}")
    text = out.read_text()
    if ext == "json":
        assert len(json.loads(text)["files"]) == 2
    elif ext == "csv":
        assert "'=cmd|x.txt" in text  # injection de formule neutralisée
    else:
        assert "<script>" not in text and "&lt;script&gt;" in text
