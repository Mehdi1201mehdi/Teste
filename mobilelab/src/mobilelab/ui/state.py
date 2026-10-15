"""État partagé entre pages : appareils détectés, mode simulation, détection périodique."""

from __future__ import annotations

from PySide6.QtCore import QObject, QTimer, Signal

from mobilelab.context import AppContext
from mobilelab.core.logging_setup import get_logger
from mobilelab.core.models import Device
from mobilelab.services.devices import ScanResult
from mobilelab.ui.workers import Worker, start

log = get_logger("ui.state")


class AppState(QObject):
    devices_changed = Signal(list, list)  # appareils, problèmes
    simulation_changed = Signal(bool)
    scanning_changed = Signal(bool)
    navigate = Signal(str)

    POLL_MS = 4000

    def __init__(self, ctx: AppContext) -> None:
        super().__init__()
        self.ctx = ctx
        self.devices: list[Device] = []
        self.problems: list[str] = []
        self._worker: Worker | None = None
        self._last_key: tuple | None = None
        self.timer = QTimer(self)
        self.timer.setInterval(self.POLL_MS)
        self.timer.timeout.connect(self.scan)

    @property
    def simulation(self) -> bool:
        return self.ctx.simulation

    def set_simulation(self, enabled: bool) -> None:
        if enabled == self.ctx.simulation:
            return
        self.ctx.simulation = enabled
        self._last_key = None
        self.simulation_changed.emit(enabled)
        self.scan()

    def scan(self) -> None:
        if self._worker is not None:
            return  # une détection est déjà en cours
        self.scanning_changed.emit(True)
        service = self.ctx.devices
        self._worker = Worker(lambda worker: service.scan())
        self._worker.signals.done.connect(self._on_scan)
        self._worker.signals.finished.connect(self._on_finished)
        start(self._worker)

    def _on_scan(self, result: ScanResult) -> None:
        key = (tuple((d.serial, d.state, d.model) for d in result.devices), tuple(result.problems))
        self.devices, self.problems = result.devices, result.problems
        if key != self._last_key:  # n'actualise l'UI que si quelque chose a changé
            self._last_key = key
            log.info("Appareils détectés : %d (%d prêt(s)).", len(result.devices),
                     sum(1 for d in result.devices if d.state.usable))
            self.devices_changed.emit(result.devices, result.problems)

    def _on_finished(self) -> None:
        self._worker = None
        self.scanning_changed.emit(False)
