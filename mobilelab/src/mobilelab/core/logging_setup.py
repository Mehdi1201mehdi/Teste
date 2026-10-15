"""Journalisation : fichier privé avec rotation, masquage des secrets, tampon pour l'UI."""

from __future__ import annotations

import logging
import os
import re
import threading
from collections import deque
from collections.abc import Callable
from logging.handlers import RotatingFileHandler
from pathlib import Path

LOGGER_NAME = "mobilelab"

_SECRET_PATTERNS = [
    re.compile(r"(?i)\b(bearer)(\s+)(\S+)"),
    # clé=valeur / clé: valeur
    re.compile(
        r"(?i)\b(password|passwd|pwd|passcode|token|secret|api[_-]?key|authorization)"
        r"(\s*[=:]\s*|\s+)(\"[^\"]*\"|'[^']*'|\S+)"
    ),
]


def redact(text: str) -> str:
    """Masque les valeurs ressemblant à des secrets."""
    for pattern in _SECRET_PATTERNS:
        text = pattern.sub(lambda m: f"{m.group(1)}{m.group(2)}***", text)
    return text


class RedactingFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = redact(record.getMessage())
        record.args = None
        return True


class LogBuffer(logging.Handler):
    """Garde les derniers messages en mémoire et notifie des abonnés (UI)."""

    def __init__(self, capacity: int = 2000) -> None:
        super().__init__()
        self._records: deque[str] = deque(maxlen=capacity)
        self._listeners: list[Callable[[str], None]] = []
        self._lock = threading.Lock()

    def emit(self, record: logging.LogRecord) -> None:
        line = self.format(record)
        with self._lock:
            self._records.append(line)
            listeners = list(self._listeners)
        for listener in listeners:
            try:
                listener(line)
            except Exception:  # noqa: BLE001, S110 - un abonné défaillant ne casse pas le log
                pass

    def lines(self) -> list[str]:
        with self._lock:
            return list(self._records)

    def subscribe(self, listener: Callable[[str], None]) -> None:
        with self._lock:
            self._listeners.append(listener)

    def unsubscribe(self, listener: Callable[[str], None]) -> None:
        with self._lock:
            if listener in self._listeners:
                self._listeners.remove(listener)


_buffer: LogBuffer | None = None


def setup_logging(log_dir: Path, level: int = logging.INFO) -> LogBuffer:
    """Configure le logger applicatif (idempotent)."""
    global _buffer
    logger = logging.getLogger(LOGGER_NAME)
    if _buffer is not None:
        return _buffer

    logger.setLevel(level)
    logger.propagate = False
    fmt = logging.Formatter("%(asctime)s %(levelname)-7s %(name)s: %(message)s")
    redactor = RedactingFilter()

    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / "mobilelab.log"
    file_handler = RotatingFileHandler(
        log_file, maxBytes=2_000_000, backupCount=3, encoding="utf-8"
    )
    file_handler.setFormatter(fmt)
    file_handler.addFilter(redactor)
    logger.addHandler(file_handler)
    if os.name == "posix":
        os.chmod(log_file, 0o600)

    _buffer = LogBuffer()
    _buffer.setFormatter(fmt)
    _buffer.addFilter(redactor)
    logger.addHandler(_buffer)
    return _buffer


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(f"{LOGGER_NAME}.{name}")
