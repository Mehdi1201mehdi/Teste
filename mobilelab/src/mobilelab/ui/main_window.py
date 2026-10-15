"""Fenêtre principale : navigation latérale, bandeau simulation, pages."""

from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import QSize
from PySide6.QtGui import QKeySequence, QShortcut
from PySide6.QtWidgets import (
    QCheckBox,
    QFrame,
    QHBoxLayout,
    QListWidget,
    QListWidgetItem,
    QMainWindow,
    QStackedWidget,
    QVBoxLayout,
    QWidget,
)

from mobilelab import APP_NAME, __version__
from mobilelab.core.models import Device
from mobilelab.ui.icons import icon
from mobilelab.ui.pages.analysis import AnalysisPage
from mobilelab.ui.pages.backup import BackupPage
from mobilelab.ui.pages.devices import DevicesPage
from mobilelab.ui.pages.manager import ManagerPage
from mobilelab.ui.pages.misc import DiagnosticsPage, LogsPage, ModulesPage, RecoveryPage
from mobilelab.ui.state import AppState
from mobilelab.ui.widgets import label

NAV = [
    ("devices", "Appareils", "devices"),
    ("backup", "Sauvegarde", "backup"),
    ("manager", "Gestion", "manager"),
    ("analysis", "Analyse", "analysis"),
    ("recovery", "Récupération", "recovery"),
    ("diagnostics", "Diagnostic", "diagnostics"),
    ("logs", "Journal", "logs"),
    ("modules", "Modules", "modules"),
]


class MainWindow(QMainWindow):
    def __init__(self, state: AppState) -> None:
        super().__init__()
        self.state = state
        self.setWindowTitle(APP_NAME)
        self.setMinimumSize(1080, 700)
        self.resize(1280, 820)

        root = QWidget()
        layout = QHBoxLayout(root)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        # Barre latérale
        side = QFrame()
        side.setObjectName("sidebar")
        side.setFixedWidth(232)
        sl = QVBoxLayout(side)
        sl.setContentsMargins(0, 22, 0, 16)
        sl.setSpacing(4)
        brand = QVBoxLayout()
        brand.setContentsMargins(22, 0, 22, 18)
        brand.addWidget(label(APP_NAME, "brand"))
        brand.addWidget(label("Boîte à outils mobile ouverte", "brandTag"))
        sl.addLayout(brand)
        self.nav = QListWidget()
        self.nav.setObjectName("nav")
        self.nav.setIconSize(QSize(18, 18))
        self.nav.setAccessibleName("Navigation principale")
        for i, (_key, text, ic) in enumerate(NAV, 1):
            item = QListWidgetItem(icon(ic), text)
            item.setToolTip(f"{text} (Ctrl+{i})")
            self.nav.addItem(item)
        sl.addWidget(self.nav, 1)
        self.sim_toggle = QCheckBox("Mode simulation")
        self.sim_toggle.setStyleSheet("color:#C9D3DB; padding: 0 22px;")
        self.sim_toggle.setToolTip("Appareils et données factices pour découvrir l'interface")
        self.sim_toggle.setChecked(state.simulation)
        self.sim_toggle.toggled.connect(state.set_simulation)
        sl.addWidget(self.sim_toggle)
        foot = label(f"v{__version__} · open source", "sidebarFoot")
        foot.setContentsMargins(22, 8, 22, 0)
        sl.addWidget(foot)
        layout.addWidget(side)

        # Zone principale
        main = QVBoxLayout()
        main.setContentsMargins(0, 0, 0, 0)
        main.setSpacing(0)
        self.banner = QFrame()
        self.banner.setObjectName("banner")
        bl = QHBoxLayout(self.banner)
        bl.setContentsMargins(16, 8, 16, 8)
        bl.addWidget(label("MODE SIMULATION — appareils et fichiers factices. Aucune donnée "
                           "affichée n'est réelle.", wrap=True), 1)
        holder = QWidget()
        hl = QVBoxLayout(holder)
        hl.setContentsMargins(24, 12, 24, 0)
        hl.addWidget(self.banner)
        main.addWidget(holder)
        self.banner_holder = holder

        self.stack = QStackedWidget()
        self.pages = {
            "devices": DevicesPage(state),
            "backup": BackupPage(state),
            "manager": ManagerPage(state),
            "analysis": AnalysisPage(state),
            "recovery": RecoveryPage(state),
            "diagnostics": DiagnosticsPage(state),
            "logs": LogsPage(state),
            "modules": ModulesPage(state),
        }
        for key, _t, _i in NAV:
            self.stack.addWidget(self.pages[key])
        main.addWidget(self.stack, 1)
        layout.addLayout(main, 1)
        self.setCentralWidget(root)

        self.nav.currentRowChanged.connect(self._on_nav)
        self.nav.setCurrentRow(0)
        for i in range(len(NAV)):
            QShortcut(QKeySequence(f"Ctrl+{i + 1}"), self,
                      activated=lambda i=i: self.nav.setCurrentRow(i))
        QShortcut(QKeySequence("F5"), self, activated=state.scan)

        state.navigate.connect(self.go)
        state.simulation_changed.connect(self._on_simulation)
        state.devices_changed.connect(self._on_devices)
        self._on_simulation(state.simulation)
        self.statusBar().showMessage("Recherche d'appareils…")

    def go(self, target: str) -> None:
        key, _, arg = target.partition(":")
        keys = [k for k, _t, _i in NAV]
        if key in keys:
            self.nav.setCurrentRow(keys.index(key))
        if key == "analysis" and arg:
            self.pages["analysis"].open(Path(arg))

    def _on_nav(self, row: int) -> None:
        self.stack.setCurrentIndex(row)
        if NAV[row][0] == "diagnostics" and not self.pages["diagnostics"].checks:
            self.pages["diagnostics"].run()

    def _on_simulation(self, enabled: bool) -> None:
        self.banner_holder.setVisible(enabled)
        if self.sim_toggle.isChecked() != enabled:
            self.sim_toggle.setChecked(enabled)
        self.setWindowTitle(f"{APP_NAME} — SIMULATION" if enabled else APP_NAME)

    def _on_devices(self, devices: list[Device], problems: list[str]) -> None:
        ready = sum(1 for d in devices if d.state.usable)
        msg = f"{len(devices)} appareil(s) détecté(s), {ready} prêt(s)"
        if problems:
            msg += f" · {len(problems)} outil(s) indisponible(s), voir Diagnostic"
        self.statusBar().showMessage(msg)

    def showEvent(self, event) -> None:  # noqa: N802 - API Qt
        super().showEvent(event)
        if not self.state.timer.isActive():
            self.state.scan()
            self.state.timer.start()

    def closeEvent(self, event) -> None:  # noqa: N802
        self.state.timer.stop()
        super().closeEvent(event)

