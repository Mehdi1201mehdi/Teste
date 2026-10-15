"""Racine de composition : assemble services et adaptateurs (sans Qt)."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from mobilelab.adapters.adb import AdbAdapter
from mobilelab.adapters.base import DeviceAdapter
from mobilelab.adapters.ios import LibimobiledeviceAdapter
from mobilelab.adapters.simulated import SimulatedAndroidAdapter, SimulatedIosAdapter
from mobilelab.core.db import MetadataStore
from mobilelab.core.logging_setup import LogBuffer, setup_logging
from mobilelab.core.paths import app_data_dir
from mobilelab.core.runner import CommandRunner
from mobilelab.services.backup import BackupService
from mobilelab.services.devices import DeviceService


@dataclass
class AppContext:
    data_dir: Path
    runner: CommandRunner
    store: MetadataStore
    log_buffer: LogBuffer
    backups: BackupService
    simulation: bool = False
    _real: list[DeviceAdapter] = field(default_factory=list)
    _sim: list[DeviceAdapter] = field(default_factory=list)

    @property
    def devices(self) -> DeviceService:
        return DeviceService(self._sim if self.simulation else self._real)

    @property
    def default_backup_dir(self) -> Path:
        return Path.home() / "MobileLab" / "Sauvegardes"

    def close(self) -> None:
        self.store.close()


def build_context(simulation: bool = False, data_dir: Path | None = None) -> AppContext:
    data_dir = data_dir or app_data_dir()
    buffer = setup_logging(data_dir / "logs")
    runner = CommandRunner()
    store = MetadataStore(data_dir / "mobilelab.db")
    return AppContext(
        data_dir=data_dir,
        runner=runner,
        store=store,
        log_buffer=buffer,
        backups=BackupService(store),
        simulation=simulation,
        _real=[AdbAdapter(runner), LibimobiledeviceAdapter(runner)],
        _sim=[SimulatedAndroidAdapter(delay=0.05), SimulatedIosAdapter()],
    )
