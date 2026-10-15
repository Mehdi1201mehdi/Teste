import json
import threading

import pytest

from mobilelab.adapters.simulated import SIM_HEADER, SimulatedAndroidAdapter, SimulatedIosAdapter
from mobilelab.core.errors import (
    CommandError,
    ConfirmationRequiredError,
    InsufficientSpaceError,
    UnsafePathError,
)
from mobilelab.services import backup as backup_mod
from mobilelab.services.backup import BackupService
from mobilelab.services.compare import compare_backups
from mobilelab.services.integrity import verify_backup


@pytest.fixture
def android():
    adapter = SimulatedAndroidAdapter()
    return adapter, adapter.list_devices()[0]


def test_android_backup_manifest_and_integrity(store, tmp_path, android):
    adapter, device = android
    progress = []
    res = BackupService(store).backup_android(
        adapter, device, ["/sdcard/DCIM", "/sdcard/Documents"], tmp_path / "out",
        progress=lambda d, t, m: progress.append((d, t)))
    assert res.ok_count == 4 and res.error_count == 0
    assert res.simulated
    manifest = json.loads((res.destination / "manifest.json").read_text())
    assert manifest["simulated"] is True
    assert manifest["device"]["serial"] == "SIM-ANDROID-01"
    f = res.destination / "files" / "sdcard" / "DCIM" / "Camera" / "IMG_0001.jpg"
    assert f.read_bytes().startswith(SIM_HEADER)  # jamais présenté comme réel
    assert verify_backup(res.destination).valid
    assert progress[-1] == (4, 4)
    assert store.list_backups()[0].file_count == 4
    assert store.recent_operations()[0]["status"] == "ok"


def test_tampering_detected(store, tmp_path, android):
    adapter, device = android
    res = BackupService(store).backup_android(adapter, device, ["/sdcard/Documents"], tmp_path)
    (res.destination / "files" / "sdcard" / "Documents" / "notes.txt").write_text("modifié")
    report = verify_backup(res.destination)
    assert not report.valid and report.mismatched == ["sdcard/Documents/notes.txt"]


def test_manifest_seal(store, tmp_path, android):
    adapter, device = android
    res = BackupService(store).backup_android(adapter, device, ["/sdcard/Documents"], tmp_path)
    m = res.destination / "manifest.json"
    m.write_text(m.read_text().replace("SIM-ANDROID-01", "AUTRE"))
    assert verify_backup(res.destination).manifest_tampered


def test_unauthorized_device_refused(store, tmp_path):
    adapter = SimulatedAndroidAdapter()
    with pytest.raises(Exception, match="non prêt"):
        BackupService(store).backup_android(adapter, adapter.list_devices()[1], ["/sdcard"], tmp_path)


def test_forbidden_root_refused(store, tmp_path, android):
    adapter, device = android
    with pytest.raises(UnsafePathError):
        BackupService(store).backup_android(adapter, device, ["/data/data"], tmp_path)


def test_insufficient_space(store, tmp_path, android, monkeypatch):
    adapter, device = android
    monkeypatch.setattr(backup_mod.shutil, "disk_usage",
                        lambda p: type("U", (), {"free": 10})())
    with pytest.raises(InsufficientSpaceError):
        BackupService(store).backup_android(adapter, device, ["/sdcard"], tmp_path)
    assert store.recent_operations()[0]["status"] == "error"


def test_cancel(store, tmp_path, android):
    adapter, device = android
    cancel = threading.Event()
    cancel.set()
    with pytest.raises(CommandError):
        BackupService(store).backup_android(adapter, device, ["/sdcard"], tmp_path, cancel=cancel)


def test_per_file_error_does_not_abort(store, tmp_path, android, monkeypatch):
    adapter, device = android
    original = adapter.pull

    def flaky(serial, remote, local):
        if remote.endswith(".pdf"):
            raise CommandError("câble débranché")
        original(serial, remote, local)

    monkeypatch.setattr(adapter, "pull", flaky)
    res = BackupService(store).backup_android(adapter, device, ["/sdcard"], tmp_path)
    assert res.error_count == 1 and res.ok_count == 5
    assert store.recent_operations()[0]["status"] == "partial"


def test_delete_requires_confirmation_and_manifest(store, tmp_path, android):
    adapter, device = android
    svc = BackupService(store)
    res = svc.backup_android(adapter, device, ["/sdcard/Documents"], tmp_path / "b")
    with pytest.raises(ConfirmationRequiredError):
        svc.delete_backup(res.destination, res.backup_id, confirm=False)
    other = tmp_path / "not-a-backup"
    other.mkdir()
    with pytest.raises(UnsafePathError):
        svc.delete_backup(other, None, confirm=True)
    assert other.exists()
    svc.delete_backup(res.destination, res.backup_id, confirm=True)
    assert not res.destination.exists() and store.list_backups() == []


def test_ios_simulated_backup(store, tmp_path):
    adapter = SimulatedIosAdapter()
    lines = []
    res = BackupService(store).backup_ios(adapter, adapter.list_devices()[0], tmp_path,
                                          lines.append)
    assert res.simulated and res.ok_count == 1
    assert any("SIMULATION" in ln for ln in lines)


def test_compare(store, tmp_path, android, monkeypatch):
    adapter, device = android
    svc = BackupService(store)
    a = svc.backup_android(adapter, device, ["/sdcard/Documents"], tmp_path / "a")
    b = svc.backup_android(adapter, device, ["/sdcard/Documents", "/sdcard/Download"],
                           tmp_path / "b")
    d = compare_backups(a.destination, b.destination)
    assert d.added == ["sdcard/Download/facture.pdf"] and d.unchanged == 1
