"""Page Appareils : détection, état, informations accessibles et aide contextuelle."""

from __future__ import annotations

import sys

from PySide6.QtCore import QSize, Qt
from PySide6.QtWidgets import (
    QFormLayout,
    QFrame,
    QHBoxLayout,
    QLabel,
    QListWidget,
    QListWidgetItem,
    QVBoxLayout,
    QWidget,
)

from mobilelab.core.models import ConnectionState, Device, Platform
from mobilelab.services.devices import ANDROID_SETUP_STEPS, help_for
from mobilelab.ui.icons import icon
from mobilelab.ui.state import AppState
from mobilelab.ui.widgets import Card, Page, Pill, button, label

_LEVEL = {ConnectionState.READY: "ok", ConnectionState.UNAUTHORIZED: "warn",
          ConnectionState.UNPAIRED: "warn", ConnectionState.OFFLINE: "error"}

_PROP_LABELS = {
    "ro.build.version.sdk": "Niveau d'API",
    "ro.build.version.security_patch": "Correctif de sécurité",
    "ro.product.cpu.abi": "Architecture",
    "ro.product.device": "Nom de code",
    "ro.product.brand": "Marque",
    "ProductType": "Identifiant modèle",
    "BuildVersion": "Build",
    "DeviceClass": "Catégorie",
    "HardwareModel": "Modèle matériel",
    "CPUArchitecture": "Architecture",
}


class DeviceTile(QFrame):
    def __init__(self, device: Device) -> None:
        super().__init__()
        self.setObjectName("card")
        row = QHBoxLayout(self)
        row.setContentsMargins(14, 12, 14, 12)
        row.setSpacing(12)
        glyph = QLabel()
        glyph.setPixmap(icon("android" if device.platform is Platform.ANDROID else "apple",
                             "#0B7A6A", 28).pixmap(28, 28))
        row.addWidget(glyph)
        col = QVBoxLayout()
        col.setSpacing(2)
        col.addWidget(label(device.display_name, "h2", wrap=True))
        meta = [device.os_version, device.transport, "simulé" if device.simulated else ""]
        col.addWidget(label(" · ".join(p for p in meta if p), "muted"))
        row.addLayout(col, 1)
        row.addWidget(Pill(device.state.label, _LEVEL.get(device.state, "info")))
        self.setAccessibleName(f"{device.display_name}, {device.state.label}")


class DeviceList(QListWidget):
    """Liste dont les tuiles occupent toujours toute la largeur (pas de défilement horizontal)."""

    def __init__(self) -> None:
        super().__init__()
        self.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.setVerticalScrollMode(QListWidget.ScrollMode.ScrollPerPixel)
        self.setResizeMode(QListWidget.ResizeMode.Adjust)

    def fit_items(self) -> None:
        width = self.viewport().width()
        for i in range(self.count()):
            item = self.item(i)
            item.setSizeHint(QSize(width, item.sizeHint().height()))

    def resizeEvent(self, event) -> None:  # noqa: N802 - API Qt
        super().resizeEvent(event)
        self.fit_items()


class DevicesPage(Page):
    def __init__(self, state: AppState) -> None:
        super().__init__("Appareils",
                         "Appareils Android (ADB) et Apple (libimobiledevice) connectés à "
                         "cet ordinateur. La liste se met à jour automatiquement.")
        self.state = state
        self.refresh_btn = button("Actualiser", tooltip="Relancer la détection (F5)")
        self.refresh_btn.setIcon(icon("refresh", "#5A6273", 16))
        self.refresh_btn.clicked.connect(state.scan)
        self.actions.addWidget(self.refresh_btn)

        self.problems = label("", "muted", wrap=True)
        self.problems.hide()
        self.content.addWidget(self.problems)

        split = QHBoxLayout()
        split.setSpacing(16)
        self.list = DeviceList()
        self.list.setObjectName("deviceList")
        self.list.setMinimumWidth(320)
        self.list.setAccessibleName("Liste des appareils")
        self.list.currentRowChanged.connect(self._show_detail)
        split.addWidget(self.list, 2)

        self.detail = Card()
        self.detail.setMinimumWidth(340)
        split.addWidget(self.detail, 3)
        holder = QWidget()
        holder.setLayout(split)
        holder.setMinimumHeight(420)
        self.content.addWidget(holder)
        self.content.addStretch(1)

        state.devices_changed.connect(self._populate)
        state.scanning_changed.connect(lambda busy: self.refresh_btn.setEnabled(not busy))
        self._populate([], [])

    # -- rendu -----------------------------------------------------------------
    def _populate(self, devices: list[Device], problems: list[str]) -> None:
        current = self._current_serial()
        self.list.clear()
        for d in devices:
            item = QListWidgetItem()
            item.setData(Qt.ItemDataRole.UserRole, d)
            tile = DeviceTile(d)
            item.setSizeHint(QSize(self.list.viewport().width(), max(tile.sizeHint().height(), 72)))
            self.list.addItem(item)
            self.list.setItemWidget(item, tile)
        self.list.fit_items()
        self.problems.setVisible(bool(problems))
        self.problems.setText("Outils : " + " · ".join(problems) if problems else "")
        if not devices:
            self._empty_state()
            return
        serials = [d.serial for d in devices]
        self.list.setCurrentRow(serials.index(current) if current in serials else 0)

    def _current_serial(self) -> str | None:
        item = self.list.currentItem()
        return item.data(Qt.ItemDataRole.UserRole).serial if item else None

    def _reset_detail(self) -> QVBoxLayout:
        body = self.detail.body
        while body.count():
            child = body.takeAt(0)
            if child.widget():
                child.widget().deleteLater()
            elif child.layout():
                _clear_layout(child.layout())
        return body

    def _empty_state(self) -> None:
        body = self._reset_detail()
        body.addWidget(label("Aucun appareil détecté", "h2"))
        body.addWidget(label("Branchez un appareil avec un câble de données. Pour Android, "
                             "le débogage USB doit être activé :", "muted", wrap=True))
        for i, step in enumerate(ANDROID_SETUP_STEPS, 1):
            body.addWidget(label(f"{i}. {step}", wrap=True))
        body.addWidget(label("Pour iPhone/iPad : déverrouillez l'appareil et acceptez « Faire "
                             "confiance à cet ordinateur ».", "muted", wrap=True))
        if sys.platform == "win32":
            body.addWidget(label(
                "Windows : si le téléphone n'apparaît pas, installez le pilote USB de son "
                "fabricant (Samsung, Xiaomi…) ou le « Google USB Driver » ; pour un iPhone, "
                "installez l'application « Appareils Apple » ou iTunes (Microsoft Store).",
                "muted", wrap=True))
        if self.state.problems:
            tools = button("Installer les outils manquants (Diagnostic)", flat=True)
            tools.clicked.connect(lambda: self.state.navigate.emit("diagnostics"))
            body.addWidget(tools, 0, Qt.AlignmentFlag.AlignLeft)
        if not self.state.simulation:
            demo = button("Essayer avec des appareils simulés", flat=True)
            demo.clicked.connect(lambda: self.state.set_simulation(True))
            body.addWidget(demo, 0, Qt.AlignmentFlag.AlignLeft)
        body.addStretch(1)

    def _show_detail(self, row: int) -> None:
        if row < 0:
            return
        device: Device = self.list.item(row).data(Qt.ItemDataRole.UserRole)
        body = self._reset_detail()
        head = QHBoxLayout()
        head.addWidget(label(device.display_name, "h1"), 1)
        head.addWidget(Pill(device.state.label, _LEVEL.get(device.state, "info")))
        body.addLayout(head)
        if device.simulated:
            body.addWidget(label("Appareil simulé : aucune donnée réelle.", "muted"))

        form = QFormLayout()
        form.setHorizontalSpacing(24)
        form.setVerticalSpacing(6)
        rows = [("Plateforme", "Android" if device.platform is Platform.ANDROID else "Apple"),
                ("Système", device.os_version or "—"),
                ("Connexion", device.transport),
                ("Identifiant", device.serial)]
        rows += [(lbl, device.properties[k]) for k, lbl in _PROP_LABELS.items()
                 if k in device.properties]
        for k, v in rows:
            form.addRow(label(k, "muted"), label(v))
        body.addLayout(form)

        body.addSpacing(6)
        body.addWidget(label("Que faire ?", "h2"))
        for tip in help_for(device):
            body.addWidget(label("• " + tip, wrap=True))
        if device.state.usable:
            row = QHBoxLayout()
            go = button("Sauvegarder cet appareil", primary=True)
            go.clicked.connect(lambda: self.state.navigate.emit("backup"))
            row.addWidget(go)
            if device.platform is Platform.ANDROID:
                manage = button("Applications, capture, transferts")
                manage.clicked.connect(lambda: self.state.navigate.emit("manager"))
                row.addWidget(manage)
            row.addStretch(1)
            body.addSpacing(8)
            body.addLayout(row)
        body.addStretch(1)


def _clear_layout(layout) -> None:
    while layout.count():
        child = layout.takeAt(0)
        if child.widget():
            child.widget().deleteLater()
        elif child.layout():
            _clear_layout(child.layout())
