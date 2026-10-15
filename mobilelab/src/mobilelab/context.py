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
from mobilelab.core.settings import Settings
from mobilelab.services.backup import BackupService
from mobilelab.services.devices import DeviceService
from mobilelab.services.manager import ManagerService


@dataclass
class AppContext:
    data_dir: Path
    runner: CommandRunner
    store: MetadataStore
    log_buffer: LogBuffer
    backups: BackupService
    manager: ManagerService
    settings: Settings = field(default_factory=Settings)
    simulation: bool = False
    _real: list[DeviceAdapter] = field(default_factory=list)
    _sim: list[DeviceAdapter] = field(default_factory=list)

    @property
    def devices(self) -> DeviceService:
        return DeviceService(self._sim if self.simulation else self._real)

    @property
    def default_backup_dir(self) -> Path:
        if self.settings.backup_dir:
            return Path(self.settings.backup_dir)
        return Path.home() / "MobileLab" / "Sauvegardes"

    @property
    def tools_dir(self) -> Path:
        return self.data_dir / "tools"

    def save_settings(self) -> None:
        self.settings.save(self.data_dir / "settings.json")

    def set_tool_path(self, tool: str, path: str | None) -> None:
        self.runner.set_override(tool, path)
        if path:
            self.settings.tool_paths[tool] = path
        else:
            self.settings.tool_paths.pop(tool, None)
        self.save_settings()

    def close(self) -> None:
        self.store.close()


def build_context(simulation: bool = False, data_dir: Path | None = None) -> AppContext:
    data_dir = data_dir or app_data_dir()
    buffer = setup_logging(data_dir / "logs")
    settings = Settings.load(data_dir / "settings.json")
    runner = CommandRunner(overrides=settings.tool_paths, tool_dirs=[data_dir / "tools"])
    store = MetadataStore(data_dir / "mobilelab.db")
    return AppContext(
        data_dir=data_dir,
        runner=runner,
        store=store,
        log_buffer=buffer,
        backups=BackupService(store),
        manager=ManagerService(store),
        settings=settings,
        simulation=simulation,
        _real=[AdbAdapter(runner), LibimobiledeviceAdapter(runner)],
        _sim=[SimulatedAndroidAdapter(delay=0.05), SimulatedIosAdapter()],
    )
