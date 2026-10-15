import pytest

from mobilelab.adapters.adb import (
    AdbAdapter,
    parse_devices,
    parse_df,
    parse_find_stat,
    parse_getprop,
)
from mobilelab.adapters.ios import LibimobiledeviceAdapter, parse_ideviceinfo, parse_udids
from mobilelab.core.errors import CommandError, ToolNotFoundError
from mobilelab.core.models import ConnectionState
from tests.conftest import FakeRunner, ok

ADB_DEVICES = """List of devices attached
emulator-5554          device product:sdk_gphone64 model:sdk_gphone64_x86_64 device:emu64x transport_id:1
R58M12345XYZ           unauthorized usb:1-1 transport_id:2
192.168.1.20:5555      offline transport_id:3
????????????           no permissions (user in plugdev group; are your udev rules wrong?); see [http://developer.android.com/tools/device.html]
"""

GETPROP = """[ro.product.model]: [Pixel 7]
[ro.product.manufacturer]: [Google]
[ro.build.version.release]: [15]
[persist.sys.timezone]: [Europe/Paris]
"""


def test_parse_devices_states():
    parsed = parse_devices(ADB_DEVICES)
    assert [p[1] for p in parsed] == ["device", "unauthorized", "offline", "no permissions"]
    assert parsed[0][2]["model"] == "sdk_gphone64_x86_64"


def test_parse_getprop_whitelist_only():
    props = parse_getprop(GETPROP)
    assert props == {"ro.product.model": "Pixel 7", "ro.product.manufacturer": "Google",
                     "ro.build.version.release": "15"}


def test_parse_find_stat_ignores_errors():
    out = "1200|1700000000|/sdcard/a b.txt\nfind: '/sdcard/x': Permission denied\n5|0|/sdcard/c|d"
    files = parse_find_stat(out)
    assert [f.path for f in files] == ["/sdcard/a b.txt", "/sdcard/c|d"]
    assert files[0].size == 1200


def test_parse_df():
    out = "Filesystem     1K-blocks    Used Available Use% Mounted on\n" \
          "/dev/fuse      115000000 70000000 45000000  61% /storage/emulated"
    info = parse_df(out)
    assert info.free_bytes == 45000000 * 1024


def test_adb_list_devices_reads_props_only_when_ready():
    runner = FakeRunner({("adb", "devices", "-l"): ok(ADB_DEVICES),
                         ("adb", "-s", "emulator-5554", "shell", "getprop"): ok(GETPROP)})
    devices = AdbAdapter(runner).list_devices()
    by_serial = {d.serial: d for d in devices}
    assert by_serial["emulator-5554"].state is ConnectionState.READY
    assert by_serial["emulator-5554"].model == "Pixel 7"
    assert by_serial["emulator-5554"].transport == "émulateur"
    assert by_serial["R58M12345XYZ"].state is ConnectionState.UNAUTHORIZED
    assert by_serial["192.168.1.20:5555"].transport == "réseau"
    assert by_serial["????????????"].properties["hint"] == "udev"
    getprop_calls = [c for c in runner.calls if "getprop" in c]
    assert len(getprop_calls) == 1


def test_adb_list_files_quotes_remote_path():
    runner = FakeRunner({("adb", "-s", "S", "shell"): ok("10|1|/sdcard/My Dir/a.jpg\n"
                                                        "10|1|/sdcard/Other/b.jpg")})
    files = AdbAdapter(runner).list_files("S", "/sdcard/My Dir")
    assert [f.path for f in files] == ["/sdcard/My Dir/a.jpg"]  # hors racine filtré
    assert "'/sdcard/My Dir'" in runner.calls[0][-1]


def test_adb_missing_tool():
    with pytest.raises(ToolNotFoundError):
        AdbAdapter(FakeRunner(tools=set())).list_devices()


def test_ios_parsers():
    assert parse_udids("00008110-001A2B3C4D5E6F7A\ngarbage\n") == ["00008110-001A2B3C4D5E6F7A"]
    info = parse_ideviceinfo("ProductType: iPhone14,5\nDeviceName: Jean's iPhone\n"
                             "ProductVersion: 18.0")
    assert info == {"ProductType": "iPhone14,5", "ProductVersion": "18.0"}  # pas de nom perso


def test_ios_unpaired_device():
    udid = "00008110-001A2B3C4D5E6F7A"
    runner = FakeRunner({
        ("idevice_id", "-l"): ok(udid + "\n"),
        ("ideviceinfo",): ok("", 255, "ERROR: Could not connect to lockdownd: Pairing dialog "
                                      "response pending"),
    })
    [d] = LibimobiledeviceAdapter(runner).list_devices()
    assert d.state is ConnectionState.UNPAIRED


def test_ios_usbmuxd_down():
    runner = FakeRunner({("idevice_id", "-l"): ok("", 255, "ERROR: Unable to retrieve device list!")})
    with pytest.raises(CommandError):
        LibimobiledeviceAdapter(runner).list_devices()
