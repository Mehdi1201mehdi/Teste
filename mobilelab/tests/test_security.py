from pathlib import Path

import pytest

from mobilelab.core.errors import UnsafePathError
from mobilelab.core.logging_setup import redact
from mobilelab.core.paths import safe_join, sanitize_component, validate_android_path
from mobilelab.core.runner import CommandRunner


@pytest.mark.parametrize("path", ["/sdcard/DCIM", "/storage/emulated/0/Download", "/sdcard"])
def test_android_paths_allowed(path):
    assert validate_android_path(path) == path


@pytest.mark.parametrize("path", [
    "sdcard/DCIM",                 # relatif
    "/data/data/com.app",          # données privées d'application
    "/sdcard/../data",             # remontée
    "/sdcard/a\nb",                # caractère de contrôle
    "/system/etc",
    "",
])
def test_android_paths_rejected(path):
    with pytest.raises(UnsafePathError):
        validate_android_path(path)


def test_safe_join_stays_inside(tmp_path: Path):
    assert safe_join(tmp_path, "sdcard/DCIM/a.jpg") == tmp_path / "sdcard" / "DCIM" / "a.jpg"
    with pytest.raises(UnsafePathError):
        safe_join(tmp_path, "../evil")


def test_sanitize_component_windows_names():
    assert sanitize_component("CON.txt") == "_CON.txt"
    assert sanitize_component('a<b>:c"d') == "a_b__c_d"
    assert sanitize_component("..") == "_"


@pytest.mark.parametrize("text, secret", [
    ("password=hunter2", "hunter2"),
    ("token: abc.def", "abc.def"),
    ("Authorization: Bearer xyz", "xyz"),
    ("api_key='k-123'", "k-123"),
])
def test_redaction(text, secret):
    out = redact(text)
    assert secret not in out and "***" in out


def test_runner_rejects_unlisted_tool():
    with pytest.raises(UnsafePathError):
        CommandRunner().run("rm", ["-rf", "/"])


def test_runner_rejects_nul_argument(monkeypatch):
    r = CommandRunner()
    monkeypatch.setattr(r, "resolve", lambda tool: "/bin/true")
    with pytest.raises(UnsafePathError):
        r.run("adb", ["a\x00b"])
