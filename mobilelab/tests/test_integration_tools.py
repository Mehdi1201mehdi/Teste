"""Tests contre les vrais binaires (ignorés s'ils ne sont pas installés).

Aucun appareil n'est requis : on vérifie que les commandes réelles sont acceptées
et que leurs sorties « sans appareil » sont correctement interprétées.
"""

import shutil

import pytest

from mobilelab.adapters.adb import AdbAdapter
from mobilelab.adapters.ios import LibimobiledeviceAdapter
from mobilelab.core.errors import CommandError
from mobilelab.core.runner import CommandRunner
from mobilelab.services.diagnostics import Level, run_checks


@pytest.mark.skipif(shutil.which("adb") is None, reason="adb absent")
def test_real_adb_no_device():
    runner = CommandRunner()
    try:
        devices = AdbAdapter(runner).list_devices()
        assert all(d.serial for d in devices)
    finally:
        runner.run("adb", ["kill-server"], timeout=15)


@pytest.mark.skipif(shutil.which("idevice_id") is None, reason="libimobiledevice absent")
def test_real_idevice_id():
    try:
        devices = LibimobiledeviceAdapter(CommandRunner()).list_devices()
        assert isinstance(devices, list)
    except CommandError as exc:  # usbmuxd absent : message actionnable attendu
        assert "usbmuxd" in str(exc)


def test_diagnostics_never_crash(tmp_path):
    runner = CommandRunner()
    checks = run_checks(runner, tmp_path)
    assert checks[0].name == "MobileLab"
    assert all(isinstance(c.level, Level) for c in checks)
    if shutil.which("adb"):
        runner.run("adb", ["kill-server"], timeout=15)
