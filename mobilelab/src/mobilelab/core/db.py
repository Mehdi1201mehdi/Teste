"""Stockage local des métadonnées (SQLite). Aucune donnée d'appareil n'y est copiée."""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

SCHEMA_VERSION = 1

_SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS operations (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    device_serial TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS backups (
    id TEXT PRIMARY KEY,
    device_serial TEXT NOT NULL,
    platform TEXT NOT NULL,
    path TEXT NOT NULL,
    created_at TEXT NOT NULL,
    file_count INTEGER NOT NULL,
    total_bytes INTEGER NOT NULL,
    simulated INTEGER NOT NULL DEFAULT 0,
    extra TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_operations_started ON operations(started_at DESC);
"""


def utcnow() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


@dataclass(frozen=True)
class BackupRecord:
    id: str
    device_serial: str
    platform: str
    path: str
    created_at: str
    file_count: int
    total_bytes: int
    simulated: bool


class MetadataStore:
    def __init__(self, db_path: Path) -> None:
        self.path = db_path
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        with self._conn:
            self._conn.executescript(_SCHEMA)
            self._conn.execute(
                "INSERT OR IGNORE INTO meta(key, value) VALUES ('schema_version', ?)",
                (str(SCHEMA_VERSION),),
            )
        if os.name == "posix":
            os.chmod(db_path, 0o600)

    @contextmanager
    def _tx(self):
        with self._lock, self._conn:
            yield self._conn

    def close(self) -> None:
        self._conn.close()

    # -- opérations -------------------------------------------------------------
    def start_operation(self, kind: str, device_serial: str | None = None) -> str:
        op_id = uuid.uuid4().hex
        with self._tx() as c:
            c.execute(
                "INSERT INTO operations(id, kind, device_serial, started_at, status)"
                " VALUES (?, ?, ?, ?, 'running')",
                (op_id, kind, device_serial, utcnow()),
            )
        return op_id

    def finish_operation(self, op_id: str, status: str, summary: str = "") -> None:
        with self._tx() as c:
            c.execute(
                "UPDATE operations SET finished_at=?, status=?, summary=? WHERE id=?",
                (utcnow(), status, summary, op_id),
            )

    def recent_operations(self, limit: int = 50) -> list[dict]:
        with self._tx() as c:
            rows = c.execute(
                "SELECT * FROM operations ORDER BY started_at DESC LIMIT ?", (limit,)
            ).fetchall()
        return [dict(r) for r in rows]

    # -- sauvegardes ------------------------------------------------------------
    def add_backup(self, record: BackupRecord, extra: dict | None = None) -> None:
        with self._tx() as c:
            c.execute(
                "INSERT INTO backups VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    record.id, record.device_serial, record.platform, record.path,
                    record.created_at, record.file_count, record.total_bytes,
                    int(record.simulated), json.dumps(extra or {}),
                ),
            )

    def list_backups(self) -> list[BackupRecord]:
        with self._tx() as c:
            rows = c.execute(
                "SELECT id, device_serial, platform, path, created_at, file_count, total_bytes,"
                " simulated FROM backups ORDER BY created_at DESC"
            ).fetchall()
        return [BackupRecord(**{**dict(r), "simulated": bool(r["simulated"])}) for r in rows]

    def forget_backup(self, backup_id: str) -> None:
        """Retire l'entrée du catalogue (ne supprime aucun fichier)."""
        with self._tx() as c:
            c.execute("DELETE FROM backups WHERE id=?", (backup_id,))
