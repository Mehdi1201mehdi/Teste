from __future__ import annotations

import os
import sqlite3
from pathlib import Path

import pytest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from mobilelab.core.db import MetadataStore  # noqa: E402
from mobilelab.core.runner import CommandResult, CommandRunner  # noqa: E402


class FakeRunner(CommandRunner):
    """Rejoue des sorties enregistrées ; trace les argv reçus."""

    def __init__(self, responses: dict[tuple[str, ...], CommandResult] | None = None,
                 tools: set[str] | None = None) -> None:
        super().__init__()
        self.responses = responses or {}
        self.tools = tools if tools is not None else {"adb", "idevice_id", "ideviceinfo"}
        self.calls: list[tuple[str, ...]] = []

    def resolve(self, tool: str) -> str | None:
        self._check_tool(tool)
        return f"/fake/{tool}" if tool in self.tools else None

    def run(self, tool, args, timeout=30.0):
        self._build_argv(tool, args)
        key = (tool, *args)
        self.calls.append(key)
        for k, v in self.responses.items():
            if key[: len(k)] == k:
                return v
        return CommandResult(0, "", "", 0.0)


def ok(stdout: str = "", rc: int = 0, stderr: str = "") -> CommandResult:
    return CommandResult(rc, stdout, stderr, 0.0)


@pytest.fixture
def store(tmp_path: Path) -> MetadataStore:
    s = MetadataStore(tmp_path / "meta.db")
    yield s
    s.close()


@pytest.fixture(autouse=True)
def _isolated_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MOBILELAB_HOME", str(tmp_path / "home"))


def make_sqlite(path: Path, rows: int = 3) -> Path:
    conn = sqlite3.connect(path)
    conn.execute('CREATE TABLE "messages" (id INTEGER PRIMARY KEY, body TEXT, blob BLOB)')
    conn.executemany("INSERT INTO messages(body, blob) VALUES (?, ?)",
                     [(f"msg {i}", b"\x00\x01") for i in range(rows)])
    conn.commit()
    conn.close()
    return path
