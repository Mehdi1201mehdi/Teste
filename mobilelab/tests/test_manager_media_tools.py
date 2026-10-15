import io
import json
import stat
import sys
import zipfile
from pathlib import Path

import pytest

from mobilelab.adapters.adb import (
    AdbAdapter,
    parse_packages,
    parse_pm_path,
    validate_apk_path,
    validate_package,
)
from mobilelab.adapters.simulated import SimulatedAndroidAdapter, SimulatedIosAdapter
from mobilelab.core.errors import MobileLabError, UnsafePathError
from mobilelab.core.runner import CommandRunner
from mobilelab.core.settings import Settings
from mobilelab.services import tools_install
from mobilelab.services.backup import BackupService
from mobilelab.services.manager import RESTORE_ROOT, ManagerService
from mobilelab.services.media import find_duplicates, photo_summary
from tests.conftest import FakeRunner, ok


# -- ADB : gestion --------------------------------------------------------------
def test_parse_packages_and_paths():
    out = "package:com.whatsapp versionCode:241\npackage:org.x.y\nnoise\npackage:bad name"
    apps = parse_packages(out)
    assert [(a.name, a.version_code) for a in apps] == [("com.whatsapp", "241"), ("org.x.y", "")]
    paths = parse_pm_path("package:/data/app/~~a==/com.x-1/base.apk\n"
                          "package:/data/app/~~a==/com.x-1/split_config.fr.apk\n")
    assert len(paths) == 2


@pytest.mark.parametrize("bad", ["com.x; reboot", "x", "../etc", "com.x$(id)"])
def test_package_validation(bad):
    with pytest.raises(UnsafePathError):
        validate_package(bad)


@pytest.mark.parametrize("bad", ["/sdcard/x.apk", "/data/app/../../x.apk", "/data/app/a.txt"])
def test_apk_path_validation(bad):
    with pytest.raises(UnsafePathError):
        validate_apk_path(bad)


def test_adb_install_and_uninstall_commands(tmp_path):
    apk = tmp_path / "app.apk"
    apk.write_bytes(b"PK")
    runner = FakeRunner({("adb", "-s", "S", "install"): ok("Performing Streamed Install\nSuccess"),
                         ("adb", "-s", "S", "uninstall"): ok("Success")})
    adb = AdbAdapter(runner)
    assert "réussie" in adb.install("S", [apk])
    assert runner.calls[-1] == ("adb", "-s", "S", "install", "-r", str(apk))
    adb.uninstall("S", "com.example.app")
    with pytest.raises(UnsafePathError):
        adb.install("S", [tmp_path / "virus.exe"])


def test_adb_install_failure_reported(tmp_path):
    apk = tmp_path / "a.apk"
    apk.write_bytes(b"PK")
    runner = FakeRunner({("adb", "-s", "S", "install"): ok("Failure [INSTALL_FAILED_OLDER_SDK]", 1)})
    with pytest.raises(MobileLabError, match="refusée"):
        AdbAdapter(runner).install("S", [apk])


def test_adb_screenshot_checks_png():
    runner = FakeRunner(binary={("adb", "-s", "S", "exec-out"): b"\x89PNG\r\n\x1a\nDATA"})
    assert AdbAdapter(runner).screenshot("S").startswith(b"\x89PNG")
    runner = FakeRunner(binary={("adb", "-s", "S", "exec-out"): b"error: device locked"})
    with pytest.raises(MobileLabError):
        AdbAdapter(runner).screenshot("S")


# -- service de gestion ----------------------------------------------------------
@pytest.fixture
def sim():
    adapter = SimulatedAndroidAdapter()
    return adapter, adapter.list_devices()[0]


def test_export_apks(store, tmp_path, sim):
    adapter, device = sim
    report = ManagerService(store).export_apks(adapter, device,
                                               ["org.demo.notes", "org.absent"], tmp_path)
    assert (tmp_path / "org.demo.notes.apk").exists()
    assert len(report.done) == 1 and report.skipped[0][0] == "org.absent"


def test_push_never_overwrites(store, tmp_path, sim):
    adapter, device = sim
    f = tmp_path / "photo.jpg"
    f.write_bytes(b"x")
    svc = ManagerService(store)
    first = svc.push_files(adapter, device, [f]).done[0][1]
    second = svc.push_files(adapter, device, [f]).done[0][1]
    assert first == "/sdcard/Download/MobileLab/photo.jpg"
    assert second == "/sdcard/Download/MobileLab/photo (1).jpg"


def test_push_rejects_private_destination(store, tmp_path, sim):
    adapter, device = sim
    with pytest.raises(UnsafePathError):
        ManagerService(store).push_files(adapter, device, [tmp_path], "/data/local")


def test_restore_backup_verifies_and_isolates(store, tmp_path, sim):
    adapter, device = sim
    backup = BackupService(store).backup_android(adapter, device, ["/sdcard/Documents",
                                                                   "/sdcard/Download"], tmp_path)
    (backup.destination / "files/sdcard/Download/facture.pdf").write_bytes(b"corrompu")
    report = ManagerService(store).restore_backup(adapter, device, backup.destination)
    assert [r for _l, r in report.done] == [
        f"{RESTORE_ROOT}/{backup.destination.name}/Documents/notes.txt"]
    assert report.skipped[0][0] == "sdcard/Download/facture.pdf"


def test_simulated_backup_never_sent_to_real_device(store, tmp_path, sim):
    adapter, device = sim
    backup = BackupService(store).backup_android(adapter, device, ["/sdcard/Documents"], tmp_path)
    real = type(device)(**{**device.__dict__, "simulated": False})
    with pytest.raises(MobileLabError, match="simulation"):
        ManagerService(store).restore_backup(adapter, real, backup.destination)


def test_uninstall_requires_confirmation(store, sim):
    adapter, device = sim
    svc = ManagerService(store)
    with pytest.raises(MobileLabError):
        svc.uninstall(adapter, device, "org.demo.notes", confirm=False)
    svc.uninstall(adapter, device, "org.demo.notes", confirm=True)
    assert "org.demo.notes" not in [a.name for a in adapter.list_packages("x")]


def test_ios_device_refused_for_android_features(store, tmp_path):
    ios = SimulatedIosAdapter().list_devices()[0]
    with pytest.raises(MobileLabError, match="Android"):
        ManagerService(store).screenshot(SimulatedAndroidAdapter(), ios, tmp_path)


def test_screenshot_saved(store, tmp_path, sim):
    adapter, device = sim
    path = ManagerService(store).screenshot(adapter, device, tmp_path)
    assert path.read_bytes().startswith(b"\x89PNG")


# -- médias ----------------------------------------------------------------------
def test_duplicates(tmp_path):
    for name, data in {"a.jpg": b"same", "b.jpg": b"same", "c.jpg": b"diff", "d.jpg": b"xxxx"}.items():
        (tmp_path / name).write_bytes(data)
    groups = find_duplicates([(p.name, p) for p in tmp_path.iterdir()])
    assert len(groups) == 1 and groups[0].paths == ["a.jpg", "b.jpg"] and groups[0].wasted == 4


def test_photo_summary_reads_exif(tmp_path):
    from PIL import Image

    img = Image.new("RGB", (8, 8), "red")
    exif = Image.Exif()
    exif[0x0110] = "Pixel 8"
    exif[0x0132] = "2023:07:14 10:00:00"
    path = tmp_path / "p.jpg"
    img.save(path, exif=exif)
    s = photo_summary([("p.jpg", path, "jpeg"), ("v.mp4", tmp_path / "v.mp4", "mp4")])
    assert s.images == 1 and s.videos == 1 and s.with_exif == 1
    assert s.by_year == {"2023": 1} and s.by_camera == {"Pixel 8": 1}


# -- installation d'outils, réglages, recherche ----------------------------------
def _zip(entries: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in entries.items():
            info = zipfile.ZipInfo(name)
            info.external_attr = (stat.S_IFREG | 0o755) << 16
            zf.writestr(info, data)
    return buf.getvalue()


@pytest.mark.parametrize("url", ["http://dl.google.com/x.zip", "https://evil.example/x.zip",
                                 "file:///etc/passwd"])
def test_download_url_whitelist(url, tmp_path):
    with pytest.raises(UnsafePathError):
        tools_install.download(url, tmp_path / "x")


def test_zip_slip_refused(tmp_path):
    archive = tmp_path / "evil.zip"
    archive.write_bytes(_zip({"../evil.txt": b"x"}))
    with pytest.raises(UnsafePathError):
        tools_install.safe_extract_zip(archive, tmp_path / "out")
    assert not (tmp_path / "evil.txt").exists()


def test_install_platform_tools_requires_consent(tmp_path):
    with pytest.raises(MobileLabError):
        tools_install.install_platform_tools(tmp_path, consent=False)


def test_install_platform_tools_and_runner_finds_it(tmp_path, monkeypatch):
    exe = "adb.exe" if sys.platform == "win32" else "adb"
    payload = _zip({f"platform-tools/{exe}": b"#!/bin/sh\necho fake\n",
                    "platform-tools/NOTICE.txt": b"licence"})
    monkeypatch.setattr(tools_install, "download",
                        lambda url, target, progress=None: (target.write_bytes(payload), target)[1])
    tools = tmp_path / "tools"
    final = tools_install.install_platform_tools(tools, consent=True)
    assert final == tools / "platform-tools" / exe
    runner = CommandRunner(tool_dirs=[tools])
    assert Path(runner.resolve("adb")) == final


def test_install_imobiledevice_picks_win_x64_asset(tmp_path, monkeypatch):
    release = {"tag_name": "v1", "assets": [
        {"name": "libimobiledevice.1.2.1-r1-win-x86.zip", "browser_download_url": "https://github.com/x86"},
        {"name": "libimobiledevice.1.2.1-r1-win-x64.zip", "browser_download_url": "https://github.com/x64"},
    ]}
    payload = _zip({"bin/idevice_id.exe": b"MZ", "bin/ideviceinfo.exe": b"MZ", "bin/lib.dll": b""})

    def fake(url, target, progress=None):
        target.write_bytes(json.dumps(release).encode() if url.startswith("https://api")
                           else payload if url.endswith("x64") else b"bad")
        return target

    monkeypatch.setattr(tools_install, "download", fake)
    exe = tools_install.install_imobiledevice_windows(tmp_path, consent=True)
    assert exe.is_file() and (exe.parent / "lib.dll").is_file()


def test_settings_roundtrip(tmp_path):
    path = tmp_path / "settings.json"
    s = Settings.load(path)
    s.tool_paths["adb"] = "C:/tools/adb.exe"
    s.save(path)
    assert Settings.load(path).tool_paths == {"adb": "C:/tools/adb.exe"}
    path.write_text("{corrompu")
    assert Settings.load(path) == Settings()
