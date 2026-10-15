"""Page Gestion (Android) : applications, capture d'écran, envoi de fichiers, restauration."""

from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Qt, QUrl
from PySide6.QtGui import QDesktopServices, QPixmap
from PySide6.QtWidgets import (
    QAbstractItemView,
    QCheckBox,
    QComboBox,
    QFileDialog,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QLineEdit,
    QProgressBar,
    QTableWidget,
    QTableWidgetItem,
)

from mobilelab.core.errors import UnsafePathError
from mobilelab.core.models import Device, Platform
from mobilelab.core.paths import validate_android_path
from mobilelab.services.integrity import is_mobilelab_backup
from mobilelab.services.manager import DEFAULT_PUSH_DIR, RESTORE_ROOT, default_capture_dir
from mobilelab.ui.state import AppState
from mobilelab.ui.widgets import Card, Page, button, confirm_destructive, label, show_error
from mobilelab.ui.workers import Worker, start


class ManagerPage(Page):
    def __init__(self, state: AppState) -> None:
        super().__init__("Gestion",
                         "Applications, capture d'écran et transferts pour un appareil Android "
                         "autorisé. Rien n'est jamais écrasé sur le téléphone.")
        self.state = state
        self.ctx = state.ctx
        self.worker: Worker | None = None

        self.device_combo = QComboBox()
        self.device_combo.setMinimumWidth(320)
        self.device_combo.setAccessibleName("Appareil Android")
        self.device_combo.currentIndexChanged.connect(self._on_device)
        self.actions.addWidget(self.device_combo)

        self.progress = QProgressBar()
        self.progress.hide()
        self.status = label("", "muted", wrap=True)
        self.content.addWidget(self.progress)
        self.content.addWidget(self.status)

        # Applications
        apps = Card("Applications", "Export des APK (le programme, pas les données de "
                    "l'application), installation d'APK et désinstallation.")
        tools = QHBoxLayout()
        self.app_filter = QLineEdit()
        self.app_filter.setPlaceholderText("Filtrer les applications…")
        self.app_filter.setAccessibleName("Filtrer les applications")
        self.app_filter.textChanged.connect(self._filter_apps)
        self.system_apps = QCheckBox("Applications système")
        self.system_apps.toggled.connect(lambda _c: self.load_apps())
        refresh = button("Actualiser")
        refresh.clicked.connect(lambda: self.load_apps())
        tools.addWidget(self.app_filter, 1)
        tools.addWidget(self.system_apps)
        tools.addWidget(refresh)
        apps.body.addLayout(tools)
        self.apps_table = QTableWidget(0, 2)
        self.apps_table.setHorizontalHeaderLabels(["Application (paquet)", "Version"])
        self.apps_table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        self.apps_table.verticalHeader().hide()
        self.apps_table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.apps_table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self.apps_table.setMinimumHeight(220)
        self.apps_table.setAccessibleName("Applications installées")
        apps.body.addWidget(self.apps_table)
        row = QHBoxLayout()
        self.export_btn = button("Exporter les APK sélectionnés…")
        self.export_btn.clicked.connect(self._export)
        self.install_btn = button("Installer un APK…")
        self.install_btn.clicked.connect(self._install)
        self.uninstall_btn = button("Désinstaller…", danger=True)
        self.uninstall_btn.clicked.connect(self._uninstall)
        for b in (self.export_btn, self.install_btn, self.uninstall_btn):
            row.addWidget(b)
        row.addStretch(1)
        apps.body.addLayout(row)
        self.content.addWidget(apps)

        # Capture d'écran
        shot = Card("Capture d'écran", "Image de l'écran actuel du téléphone (déverrouillé).")
        srow = QHBoxLayout()
        self.shot_btn = button("Capturer l'écran", primary=True)
        self.shot_btn.clicked.connect(self._screenshot)
        self.open_shots = button("Ouvrir le dossier des captures")
        self.open_shots.clicked.connect(lambda: QDesktopServices.openUrl(
            QUrl.fromLocalFile(str(default_capture_dir()))))
        srow.addWidget(self.shot_btn)
        srow.addWidget(self.open_shots)
        srow.addStretch(1)
        shot.body.addLayout(srow)
        self.preview = QLabel()
        self.preview.setAlignment(Qt.AlignmentFlag.AlignLeft)
        self.preview.hide()
        shot.body.addWidget(self.preview)
        self.content.addWidget(shot)

        # Envoi PC → téléphone
        push = Card("Envoyer des fichiers vers le téléphone",
                    "Copie depuis l'ordinateur. Un fichier du même nom n'est jamais remplacé : "
                    "le nouveau reçoit un suffixe (1), (2)…")
        prow = QHBoxLayout()
        self.push_dir = QLineEdit(DEFAULT_PUSH_DIR)
        self.push_dir.setAccessibleName("Dossier de destination sur le téléphone")
        self.push_btn = button("Choisir des fichiers et envoyer…", primary=True)
        self.push_btn.clicked.connect(self._push)
        prow.addWidget(self.push_dir, 1)
        prow.addWidget(self.push_btn)
        push.body.addLayout(prow)
        self.content.addWidget(push)

        # Restauration / migration
        restore = Card("Restaurer une sauvegarde / migrer vers ce téléphone",
                       f"Renvoie une sauvegarde MobileLab dans {RESTORE_ROOT}/… sur l'appareil "
                       "choisi (le même ou un autre Android). Chaque fichier est revérifié "
                       "(SHA-256) avant l'envoi ; les fichiers d'origine ne sont pas touchés.")
        self.restore_btn = button("Choisir une sauvegarde et restaurer…", primary=True)
        self.restore_btn.clicked.connect(self._restore)
        restore.body.addWidget(self.restore_btn, 0, Qt.AlignmentFlag.AlignLeft)
        self.content.addWidget(restore)
        self.content.addStretch(1)

        self._apps: list = []
        state.devices_changed.connect(self._refresh_devices)
        self._refresh_devices(state.devices, [])

    # -- appareil --------------------------------------------------------------
    def _refresh_devices(self, devices: list[Device], _problems: list[str]) -> None:
        current = self._device()
        self.device_combo.blockSignals(True)
        self.device_combo.clear()
        androids = [d for d in devices if d.platform is Platform.ANDROID and d.state.usable]
        for d in androids:
            self.device_combo.addItem(d.display_name + (" — SIMULATION" if d.simulated else ""), d)
        if not androids:
            self.device_combo.addItem("Aucun appareil Android prêt", None)
        for i in range(self.device_combo.count()):
            d = self.device_combo.itemData(i)
            if current is not None and d is not None and d.serial == current.serial:
                self.device_combo.setCurrentIndex(i)
        self.device_combo.blockSignals(False)
        changed = (current is None) != (self._device() is None) or (
            current is not None and self._device() is not None
            and current.serial != self._device().serial)
        self._on_device(reload=changed)

    def _device(self) -> Device | None:
        return self.device_combo.currentData() if self.device_combo.count() else None

    def _on_device(self, *_args, reload: bool = True) -> None:
        enabled = self._device() is not None and self.worker is None
        for b in (self.export_btn, self.install_btn, self.uninstall_btn, self.shot_btn,
                  self.push_btn, self.restore_btn):
            b.setEnabled(enabled)
        if reload:
            self.load_apps()

    def _adapter(self):
        return self.ctx.devices.adapter_for(self._device())

    def _run(self, job, on_done, busy_text: str) -> None:
        if self.worker is not None:
            return
        w = Worker(job)
        w.signals.progress.connect(self._on_progress)
        w.signals.done.connect(on_done)
        w.signals.failed.connect(lambda msg: (self.status.setText(f"Échec : {msg}"),
                                              show_error(self, msg)))
        w.signals.finished.connect(self._on_finished)
        self.status.setText(busy_text)
        self.progress.setRange(0, 0)
        self.progress.show()
        self.worker = w
        self._on_device(reload=False)
        start(w)

    def _on_progress(self, done: int, total: int, msg: str) -> None:
        self.progress.setRange(0, max(total, 1))
        self.progress.setValue(done)
        self.status.setText(f"{done}/{total} — {msg}")

    def _on_finished(self) -> None:
        self.worker = None
        self.progress.hide()
        self._on_device(reload=False)

    # -- applications ----------------------------------------------------------
    def load_apps(self) -> None:
        device = self._device()
        self.apps_table.setRowCount(0)
        if device is None:
            return
        adapter = self._adapter()
        system = self.system_apps.isChecked()
        self._run(lambda worker: adapter.list_packages(device.serial, system),
                  self._show_apps, "Lecture des applications…")

    def _show_apps(self, apps: list) -> None:
        self._apps = apps
        self.apps_table.setRowCount(len(apps))
        for r, a in enumerate(apps):
            self.apps_table.setItem(r, 0, QTableWidgetItem(a.name))
            self.apps_table.setItem(r, 1, QTableWidgetItem(a.version_code or "—"))
        self.status.setText(f"{len(apps)} application(s).")
        self._filter_apps(self.app_filter.text())

    def _filter_apps(self, text: str) -> None:
        text = text.lower()
        for r in range(self.apps_table.rowCount()):
            self.apps_table.setRowHidden(r, text not in self.apps_table.item(r, 0).text().lower())

    def _selected_packages(self) -> list[str]:
        rows = sorted({i.row() for i in self.apps_table.selectedItems()})
        return [self.apps_table.item(r, 0).text() for r in rows]

    def _export(self) -> None:
        pkgs = self._selected_packages()
        if not pkgs:
            show_error(self, "Sélectionnez une ou plusieurs applications.")
            return
        dest = QFileDialog.getExistingDirectory(self, "Dossier d'export des APK",
                                                str(Path.home() / "MobileLab" / "APK"))
        if not dest:
            return
        device, adapter = self._device(), self._adapter()
        self._run(lambda worker: self.ctx.manager.export_apks(
            adapter, device, pkgs, Path(dest), worker.report, worker.cancel),
            lambda r: self.status.setText(r.summary + _skipped(r)), "Export des APK…")

    def _install(self) -> None:
        files, _ = QFileDialog.getOpenFileNames(self, "APK à installer", str(Path.home()),
                                                "Applications Android (*.apk)")
        if not files:
            return
        names = ", ".join(Path(f).name for f in files)
        if not confirm_destructive(self, "Installer", f"Installer {names} sur l'appareil ?\n"
                                   "N'installez que des applications de source fiable.",
                                   "Installer"):
            return
        device, adapter = self._device(), self._adapter()
        self._run(lambda worker: self.ctx.manager.install(adapter, device,
                                                          [Path(f) for f in files]),
                  lambda msg: (self.status.setText(msg), self.load_apps()), "Installation…")

    def _uninstall(self) -> None:
        pkgs = self._selected_packages()
        if len(pkgs) != 1:
            show_error(self, "Sélectionnez une seule application à désinstaller.")
            return
        pkg = pkgs[0]
        if not confirm_destructive(self, "Désinstaller", f"Désinstaller {pkg} ?\nSes données "
                                   "sur le téléphone seront supprimées.", "Désinstaller"):
            return
        device, adapter = self._device(), self._adapter()
        self._run(lambda worker: self.ctx.manager.uninstall(adapter, device, pkg, confirm=True),
                  lambda msg: (self.status.setText(msg), self.load_apps()), "Désinstallation…")

    # -- capture, envoi, restauration -----------------------------------------
    def _screenshot(self) -> None:
        device, adapter = self._device(), self._adapter()
        self._run(lambda worker: self.ctx.manager.screenshot(adapter, device,
                                                             default_capture_dir()),
                  self._show_shot, "Capture en cours…")

    def _show_shot(self, path: Path) -> None:
        pm = QPixmap(str(path))
        if not pm.isNull():
            self.preview.setPixmap(pm.scaledToHeight(min(360, pm.height()),
                                                     Qt.TransformationMode.SmoothTransformation))
            self.preview.show()
        self.status.setText(f"Capture enregistrée : {path}")

    def _push(self) -> None:
        try:
            remote_dir = validate_android_path(self.push_dir.text().strip())
        except UnsafePathError as exc:
            show_error(self, str(exc))
            return
        files, _ = QFileDialog.getOpenFileNames(self, "Fichiers à envoyer", str(Path.home()))
        if not files:
            return
        device, adapter = self._device(), self._adapter()
        self._run(lambda worker: self.ctx.manager.push_files(
            adapter, device, [Path(f) for f in files], remote_dir, worker.report, worker.cancel),
            lambda r: self.status.setText(r.summary + _skipped(r)), "Envoi…")

    def _restore(self) -> None:
        folder = QFileDialog.getExistingDirectory(self, "Sauvegarde MobileLab à restaurer",
                                                  str(self.ctx.default_backup_dir))
        if not folder:
            return
        if not is_mobilelab_backup(Path(folder)):
            show_error(self, "Ce dossier n'est pas une sauvegarde MobileLab.")
            return
        device, adapter = self._device(), self._adapter()
        self._run(lambda worker: self.ctx.manager.restore_backup(
            adapter, device, Path(folder), worker.report, worker.cancel),
            lambda r: self.status.setText(r.summary + _skipped(r)), "Restauration…")


def _skipped(report) -> str:
    if not report.skipped:
        return ""
    first = "; ".join(f"{a} ({b})" for a, b in report.skipped[:3])
    return f"\nIgnorés : {first}" + ("…" if len(report.skipped) > 3 else "")
