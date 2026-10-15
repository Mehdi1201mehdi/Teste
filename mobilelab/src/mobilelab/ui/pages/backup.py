"""Page Sauvegarde : Android (stockage partagé) et iOS (sauvegarde complète officielle)."""

from __future__ import annotations

import shutil
from pathlib import Path

from PySide6.QtCore import QUrl
from PySide6.QtGui import QDesktopServices
from PySide6.QtWidgets import (
    QAbstractItemView,
    QCheckBox,
    QComboBox,
    QFileDialog,
    QGridLayout,
    QHBoxLayout,
    QHeaderView,
    QLineEdit,
    QProgressBar,
    QTableWidget,
    QTableWidgetItem,
)

from mobilelab.core.errors import MobileLabError, UnsafePathError
from mobilelab.core.models import BackupResult, Device, Platform
from mobilelab.core.paths import validate_android_path
from mobilelab.services.backup import DEFAULT_ANDROID_FOLDERS
from mobilelab.services.integrity import verify_backup
from mobilelab.ui.state import AppState
from mobilelab.ui.widgets import (
    Card,
    Page,
    button,
    confirm_destructive,
    human_size,
    label,
    show_error,
)
from mobilelab.ui.workers import Worker, start


class BackupPage(Page):
    def __init__(self, state: AppState) -> None:
        super().__init__("Sauvegarde",
                         "Copie locale des données auxquelles vous avez accès, avec empreinte "
                         "SHA-256 de chaque fichier et manifeste vérifiable.")
        self.state = state
        self.ctx = state.ctx
        self.worker: Worker | None = None
        self.extra_paths: list[str] = []

        # 1. Source
        src = Card("1. Appareil et contenu")
        self.device_combo = QComboBox()
        self.device_combo.setAccessibleName("Appareil à sauvegarder")
        self.device_combo.currentIndexChanged.connect(self._on_device)
        src.body.addWidget(self.device_combo)
        self.android_box = QGridLayout()
        self.folder_checks: dict[str, QCheckBox] = {}
        for i, (name, path) in enumerate(DEFAULT_ANDROID_FOLDERS.items()):
            cb = QCheckBox(f"{name}")
            cb.setToolTip(path)
            cb.setChecked(path in ("/sdcard/DCIM", "/sdcard/Pictures", "/sdcard/Documents"))
            self.folder_checks[path] = cb
            self.android_box.addWidget(cb, i // 3, i % 3)
        src.body.addLayout(self.android_box)
        custom = QHBoxLayout()
        self.custom_path = QLineEdit()
        self.custom_path.setPlaceholderText("Autre dossier, ex. /sdcard/WhatsApp/Media")
        self.custom_path.setAccessibleName("Dossier supplémentaire")
        add = button("Ajouter")
        add.clicked.connect(self._add_custom)
        custom.addWidget(self.custom_path, 1)
        custom.addWidget(add)
        src.body.addLayout(custom)
        self.extra_label = label("", "muted", wrap=True)
        self.extra_label.hide()
        src.body.addWidget(self.extra_label)
        self.ios_note = label(
            "Sauvegarde complète via idevicebackup2 (mécanisme de sauvegarde officiel d'iOS). "
            "Si le chiffrement des sauvegardes est activé sur l'appareil, le résultat sera "
            "chiffré : MobileLab ne modifie jamais ce réglage.", "muted", wrap=True)
        src.body.addWidget(self.ios_note)
        self.scope_note = label(
            "Android : seul le stockage partagé est accessible (photos, téléchargements, "
            "documents…). Les données privées des applications ne le sont pas sans root, et "
            "MobileLab ne contourne pas cette protection.", "muted", wrap=True)
        src.body.addWidget(self.scope_note)
        self.content.addWidget(src)

        # 2. Destination
        dst = Card("2. Destination")
        row = QHBoxLayout()
        self.dest = QLineEdit(str(self.ctx.default_backup_dir))
        self.dest.setAccessibleName("Dossier de destination")
        self.dest.textChanged.connect(self._update_space)
        browse = button("Parcourir…")
        browse.clicked.connect(self._browse)
        row.addWidget(self.dest, 1)
        row.addWidget(browse)
        dst.body.addLayout(row)
        self.space = label("", "muted")
        dst.body.addWidget(self.space)
        self.content.addWidget(dst)

        # 3. Exécution
        run = Card("3. Lancer")
        actions = QHBoxLayout()
        self.estimate_btn = button("Estimer la taille")
        self.estimate_btn.clicked.connect(self._estimate)
        self.start_btn = button("Lancer la sauvegarde", primary=True)
        self.start_btn.clicked.connect(self._start)
        self.cancel_btn = button("Annuler")
        self.cancel_btn.clicked.connect(self._cancel)
        self.cancel_btn.hide()
        actions.addWidget(self.estimate_btn)
        actions.addStretch(1)
        actions.addWidget(self.cancel_btn)
        actions.addWidget(self.start_btn)
        run.body.addLayout(actions)
        self.progress = QProgressBar()
        self.progress.setAccessibleName("Progression de la sauvegarde")
        self.progress.hide()
        run.body.addWidget(self.progress)
        self.status = label("", "muted", wrap=True)
        run.body.addWidget(self.status)
        self.content.addWidget(run)

        # Historique
        hist = Card("Sauvegardes enregistrées")
        self.table = QTableWidget(0, 5)
        self.table.setHorizontalHeaderLabels(["Date", "Appareil", "Fichiers", "Taille", "Type"])
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.Stretch)
        self.table.verticalHeader().hide()
        self.table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.table.setSelectionMode(QAbstractItemView.SelectionMode.SingleSelection)
        self.table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self.table.setMinimumHeight(180)
        self.table.setAccessibleName("Historique des sauvegardes")
        hist.body.addWidget(self.table)
        hrow = QHBoxLayout()
        for text, slot, kw in (("Ouvrir le dossier", self._open_selected, {}),
                               ("Vérifier l'intégrité", self._verify_selected, {}),
                               ("Analyser", self._analyze_selected, {}),
                               ("Supprimer…", self._delete_selected, {"danger": True})):
            b = button(text, **kw)
            b.clicked.connect(slot)
            hrow.addWidget(b)
        hrow.addStretch(1)
        hist.body.addLayout(hrow)
        self.content.addWidget(hist)
        self.content.addStretch(1)

        state.devices_changed.connect(self._refresh_devices)
        self._refresh_devices(state.devices, [])
        self._refresh_history()
        self._update_space()

    # -- appareils -------------------------------------------------------------
    def _refresh_devices(self, devices: list[Device], _problems: list[str]) -> None:
        current = self._device()
        self.device_combo.blockSignals(True)
        self.device_combo.clear()
        ready = [d for d in devices if d.state.usable]
        for d in ready:
            tag = " — SIMULATION" if d.simulated else ""
            self.device_combo.addItem(f"{d.display_name} ({d.os_version or d.serial}){tag}", d)
        if not ready:
            self.device_combo.addItem("Aucun appareil prêt — voir l'onglet Appareils", None)
        if current is not None:
            for i in range(self.device_combo.count()):
                d = self.device_combo.itemData(i)
                if d is not None and d.serial == current.serial:
                    self.device_combo.setCurrentIndex(i)
        self.device_combo.blockSignals(False)
        self._on_device()

    def _device(self) -> Device | None:
        return self.device_combo.currentData() if self.device_combo.count() else None

    def _on_device(self) -> None:
        d = self._device()
        is_android = d is not None and d.platform is Platform.ANDROID
        for cb in self.folder_checks.values():
            cb.setVisible(is_android or d is None)
        self.custom_path.setEnabled(is_android)
        self.scope_note.setVisible(is_android or d is None)
        self.ios_note.setVisible(d is not None and d.platform is Platform.IOS)
        self.estimate_btn.setEnabled(is_android and self.worker is None)
        self.start_btn.setEnabled(d is not None and self.worker is None)

    def _roots(self) -> list[str]:
        return [p for p, cb in self.folder_checks.items() if cb.isChecked()] + self.extra_paths

    def _add_custom(self) -> None:
        try:
            path = validate_android_path(self.custom_path.text().strip())
        except UnsafePathError as exc:
            show_error(self, str(exc))
            return
        if path not in self.extra_paths:
            self.extra_paths.append(path)
        self.custom_path.clear()
        self.extra_label.setText("Dossiers ajoutés : " + ", ".join(self.extra_paths))
        self.extra_label.show()

    # -- destination -----------------------------------------------------------
    def _browse(self) -> None:
        path = QFileDialog.getExistingDirectory(self, "Dossier de destination", self.dest.text())
        if path:
            self.dest.setText(path)

    def _update_space(self) -> None:
        probe = Path(self.dest.text()).expanduser()
        while not probe.exists() and probe != probe.parent:
            probe = probe.parent
        try:
            self.space.setText(f"Espace libre : {human_size(shutil.disk_usage(probe).free)}")
        except OSError:
            self.space.setText("Destination inaccessible.")

    # -- exécution -------------------------------------------------------------
    def _estimate(self) -> None:
        d = self._device()
        if d is None:
            return
        adapter = self.state.ctx.devices.adapter_for(d)
        roots = self._roots()
        self.status.setText("Inventaire de l'appareil…")

        def job(worker):
            return self.ctx.backups.plan_android(adapter, d, roots)

        w = Worker(job)
        w.signals.done.connect(lambda files: self.status.setText(
            f"{len(files)} fichier(s), {human_size(sum(f.size for f in files))} à copier."))
        w.signals.failed.connect(lambda msg: self.status.setText(msg))
        self._keep(w)

    def _start(self) -> None:
        d = self._device()
        if d is None:
            return
        dest = Path(self.dest.text()).expanduser()
        try:
            dest.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            show_error(self, f"Destination inutilisable : {exc}")
            return
        adapter = self.state.ctx.devices.adapter_for(d)
        roots = self._roots()
        if d.platform is Platform.ANDROID and not roots:
            show_error(self, "Sélectionnez au moins un dossier.")
            return

        def job(worker):
            if d.platform is Platform.ANDROID:
                return self.ctx.backups.backup_android(adapter, d, roots, dest,
                                                       progress=worker.report, cancel=worker.cancel)
            return self.ctx.backups.backup_ios(adapter, d, dest, worker.emit_line, worker.cancel)

        w = Worker(job)
        w.signals.progress.connect(self._on_progress)
        w.signals.line.connect(self.status.setText)
        w.signals.done.connect(self._on_done)
        w.signals.failed.connect(lambda msg: (self.status.setText(f"Échec : {msg}"),
                                              show_error(self, msg)))
        self.progress.setRange(0, 0)
        self.progress.show()
        self.cancel_btn.show()
        self.status.setText("Préparation…")
        self._keep(w)

    def _keep(self, w: Worker) -> None:
        self.worker = w
        w.signals.finished.connect(self._on_finished)
        self._on_device()
        start(w)

    def _on_progress(self, done: int, total: int, message: str) -> None:
        self.progress.setRange(0, max(total, 1))
        self.progress.setValue(done)
        self.status.setText(f"{done}/{total} — {message}")

    def _on_done(self, result: BackupResult) -> None:
        msg = (f"Terminé : {result.ok_count} fichier(s), {human_size(result.total_bytes)}"
               f" → {result.destination}")
        if result.error_count:
            msg += f"\n{result.error_count} fichier(s) non copiés : détails dans manifest.json."
        if result.simulated:
            msg += "\nSauvegarde de démonstration (simulation) : aucune donnée réelle."
        self.status.setText(msg)
        self._refresh_history()

    def _on_finished(self) -> None:
        self.worker = None
        self.progress.hide()
        self.cancel_btn.hide()
        self._on_device()

    def _cancel(self) -> None:
        if self.worker is not None:
            self.worker.cancel.set()
            self.status.setText("Annulation demandée…")

    # -- historique ------------------------------------------------------------
    def _refresh_history(self) -> None:
        records = self.ctx.store.list_backups()
        self.table.setRowCount(len(records))
        for r, rec in enumerate(records):
            values = [rec.created_at.replace("T", " ")[:16], rec.device_serial,
                      str(rec.file_count), human_size(rec.total_bytes),
                      ("Simulation" if rec.simulated else rec.platform.capitalize())]
            for c, v in enumerate(values):
                item = QTableWidgetItem(v)
                item.setData(256, rec)
                self.table.setItem(r, c, item)

    def _selected(self):
        items = self.table.selectedItems()
        if not items:
            show_error(self, "Sélectionnez une sauvegarde dans la liste.")
            return None
        return items[0].data(256)

    def _open_selected(self) -> None:
        rec = self._selected()
        if rec:
            QDesktopServices.openUrl(QUrl.fromLocalFile(rec.path))

    def _verify_selected(self) -> None:
        rec = self._selected()
        if not rec:
            return
        try:
            r = verify_backup(Path(rec.path))
        except (OSError, ValueError) as exc:
            show_error(self, f"Vérification impossible : {exc}")
            return
        if r.valid:
            self.status.setText(f"Intégrité vérifiée : {r.ok}/{r.checked} fichier(s) conformes.")
        else:
            show_error(self, f"Anomalies : {len(r.missing)} manquant(s), "
                             f"{len(r.mismatched)} altéré(s)"
                             + (", manifeste modifié" if r.manifest_tampered else "") + ".")

    def _analyze_selected(self) -> None:
        rec = self._selected()
        if rec:
            self.state.navigate.emit(f"analysis:{rec.path}")

    def _delete_selected(self) -> None:
        rec = self._selected()
        if not rec:
            return
        if not Path(rec.path).exists():
            # Dossier déjà supprimé hors de MobileLab : on retire seulement l'entrée.
            self.ctx.store.forget_backup(rec.id)
            self._refresh_history()
            return
        if not confirm_destructive(self, "Supprimer la sauvegarde",
                                   f"Supprimer définitivement {rec.path} ?",
                                   "Supprimer définitivement"):
            return
        try:
            self.ctx.backups.delete_backup(Path(rec.path), rec.id, confirm=True)
        except MobileLabError as exc:
            show_error(self, str(exc))
        self._refresh_history()
