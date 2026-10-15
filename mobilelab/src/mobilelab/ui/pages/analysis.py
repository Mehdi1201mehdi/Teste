"""Page Analyse : import d'une sauvegarde/dossier, inventaire, SQLite, extraction, rapports."""

from __future__ import annotations

import shutil
from dataclasses import dataclass, field
from pathlib import Path

from PySide6.QtCore import QAbstractTableModel, QModelIndex, QSortFilterProxyModel, Qt
from PySide6.QtWidgets import (
    QAbstractItemView,
    QComboBox,
    QFileDialog,
    QHBoxLayout,
    QHeaderView,
    QLineEdit,
    QListWidget,
    QMessageBox,
    QSplitter,
    QTableView,
    QTableWidget,
    QTableWidgetItem,
)

from mobilelab.adapters.leapp import run_leapp
from mobilelab.core.errors import MobileLabError
from mobilelab.core.paths import safe_join
from mobilelab.services import analysis
from mobilelab.services.analysis import FileRecord, IosFile, SourceKind, SourceSummary
from mobilelab.services.compare import compare_backups
from mobilelab.services.integrity import is_mobilelab_backup, read_manifest
from mobilelab.services.report import export_report
from mobilelab.ui.state import AppState
from mobilelab.ui.widgets import Card, Page, Pill, button, human_size, label, show_error
from mobilelab.ui.workers import Worker, start


@dataclass
class LoadedSource:
    summary: SourceSummary
    records: list[FileRecord] = field(default_factory=list)
    local: list[Path | None] = field(default_factory=list)
    ios_items: list[IosFile] | None = None
    note: str = ""


def load_source(path: Path) -> LoadedSource:
    """Charge une source en lecture seule (exécuté hors du fil de l'interface)."""
    summary = analysis.identify(path)
    src = LoadedSource(summary)
    if summary.kind is SourceKind.MOBILELAB:
        manifest = read_manifest(path)
        if manifest.get("simulated"):
            src.note = "Sauvegarde de SIMULATION : contenu factice."
        for e in manifest["entries"]:
            if e["status"] != "ok":
                continue
            p = path / "files" / e["relative_path"]
            src.records.append(FileRecord(e["relative_path"], e["size"],
                                          p.stat().st_mtime if p.exists() else 0,
                                          analysis.detect_type(p) if p.exists() else "absent",
                                          f"{e['source']} · sha256 {e['sha256'][:16]}…"))
            src.local.append(p)
    elif summary.kind is SourceKind.IOS_BACKUP:
        if summary.encrypted:
            src.note = ("Sauvegarde chiffrée : seules les métadonnées non chiffrées sont "
                        "affichées. MobileLab ne contourne pas le chiffrement.")
            return src
        src.ios_items = analysis.ios_files(summary.path)
        for item in src.ios_items:
            p = summary.path / item.file_id[:2] / item.file_id
            exists = p.exists()
            src.records.append(FileRecord(
                f"{item.domain}/{item.relative_path}", p.stat().st_size if exists else 0,
                p.stat().st_mtime if exists else 0,
                analysis.detect_type(p) if exists else "absent",
                f"Manifest.db · fileID {item.file_id}"))
            src.local.append(p if exists else None)
    elif summary.kind is SourceKind.ANDROID_AB:
        if summary.encrypted:
            src.note = "Sauvegarde .ab chiffrée : contenu non lisible."
            return src
        src.records = analysis.ab_members(path)
        src.local = [None] * len(src.records)
        src.note = "Archive .ab : utilisez « Extraire » pour accéder aux fichiers."
    elif summary.kind is SourceKind.FOLDER:
        for r in analysis.inventory(path):
            src.records.append(r)
            src.local.append(path / r.relative_path)
    else:  # fichier isolé
        st = path.stat()
        src.records = [FileRecord(path.name, st.st_size, st.st_mtime,
                                  analysis.detect_type(path), str(path))]
        src.local = [path]
    return src


_ROOT = QModelIndex()


class RecordModel(QAbstractTableModel):
    HEADERS = ("Chemin", "Taille", "Type", "Provenance")

    def __init__(self) -> None:
        super().__init__()
        self.records: list[FileRecord] = []

    def set_records(self, records: list[FileRecord]) -> None:
        self.beginResetModel()
        self.records = records
        self.endResetModel()

    def rowCount(self, parent=_ROOT) -> int:  # noqa: N802 - API Qt
        return 0 if parent.isValid() else len(self.records)

    def columnCount(self, parent=_ROOT) -> int:  # noqa: N802
        return len(self.HEADERS)

    def headerData(self, section, orientation, role=Qt.ItemDataRole.DisplayRole):  # noqa: N802
        if role == Qt.ItemDataRole.DisplayRole and orientation == Qt.Orientation.Horizontal:
            return self.HEADERS[section]
        return None

    def data(self, index, role=Qt.ItemDataRole.DisplayRole):
        r = self.records[index.row()]
        if role == Qt.ItemDataRole.DisplayRole:
            return (r.relative_path, human_size(r.size), r.kind, r.provenance)[index.column()]
        if role == Qt.ItemDataRole.UserRole:  # tri numérique
            return (r.relative_path.lower(), r.size, r.kind, r.provenance)[index.column()]
        if role == Qt.ItemDataRole.TextAlignmentRole and index.column() == 1:
            return int(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        return None


class RecordFilter(QSortFilterProxyModel):
    def __init__(self) -> None:
        super().__init__()
        self.text = ""
        self.kind = ""
        self.setSortRole(Qt.ItemDataRole.UserRole)

    def set(self, text: str, kind: str) -> None:
        if hasattr(self, "beginFilterChange"):  # Qt >= 6.9
            self.beginFilterChange()
            self.text, self.kind = text.lower(), kind
            self.endFilterChange(QSortFilterProxyModel.Direction.Rows)
        else:
            self.text, self.kind = text.lower(), kind
            self.invalidateFilter()

    def filterAcceptsRow(self, row: int, parent) -> bool:  # noqa: N802
        r = self.sourceModel().records[row]
        return (not self.text or self.text in r.relative_path.lower()) and \
               (not self.kind or r.kind == self.kind)


class AnalysisPage(Page):
    def __init__(self, state: AppState) -> None:
        super().__init__("Analyse",
                         "Inventaire en lecture seule de sauvegardes (MobileLab, iOS, Android "
                         ".ab) et de dossiers, avec inspection des bases SQLite.")
        self.state = state
        self.loaded: LoadedSource | None = None
        self.worker: Worker | None = None
        open_dir = button("Ouvrir un dossier…", primary=True)
        open_dir.clicked.connect(self._choose_dir)
        open_file = button("Ouvrir un fichier…")
        open_file.clicked.connect(self._choose_file)
        self.actions.addWidget(open_file)
        self.actions.addWidget(open_dir)

        # Résumé
        self.summary_card = Card()
        head = QHBoxLayout()
        self.title = label("Aucune source ouverte", "h2")
        self.kind_pill = Pill("—", "info")
        head.addWidget(self.title, 1)
        head.addWidget(self.kind_pill)
        self.summary_card.body.addLayout(head)
        self.details = label("Ouvrez une sauvegarde MobileLab, un dossier de sauvegarde iOS "
                             "(contenant Manifest.plist), un fichier .ab ou tout dossier.",
                             "muted", wrap=True)
        self.summary_card.body.addWidget(self.details)
        self.note = label("", "muted", wrap=True)
        self.summary_card.body.addWidget(self.note)
        tools = QHBoxLayout()
        self.export_btn = button("Exporter un rapport…")
        self.export_btn.clicked.connect(self._export)
        self.extract_btn = button("Extraire la sélection…")
        self.extract_btn.clicked.connect(self._extract)
        self.compare_btn = button("Comparer avec…")
        self.compare_btn.clicked.connect(self._compare)
        self.leapp_btn = button("Analyser avec ALEAPP/iLEAPP…")
        self.leapp_btn.clicked.connect(self._leapp)
        for b in (self.export_btn, self.extract_btn, self.compare_btn, self.leapp_btn):
            b.setEnabled(False)
            tools.addWidget(b)
        tools.addStretch(1)
        self.summary_card.body.addLayout(tools)
        self.content.addWidget(self.summary_card)

        # Inventaire + inspecteur
        filters = QHBoxLayout()
        self.search = QLineEdit()
        self.search.setPlaceholderText("Filtrer par chemin…")
        self.search.setAccessibleName("Filtrer les fichiers")
        self.kind_filter = QComboBox()
        self.kind_filter.setAccessibleName("Filtrer par type")
        self.kind_filter.setSizeAdjustPolicy(QComboBox.SizeAdjustPolicy.AdjustToContents)
        self.kind_filter.setMinimumWidth(150)
        self.count = label("", "muted")
        filters.addWidget(self.search, 1)
        filters.addWidget(self.kind_filter)
        filters.addWidget(self.count)
        self.content.addLayout(filters)

        self.model = RecordModel()
        self.proxy = RecordFilter()
        self.proxy.setSourceModel(self.model)
        self.view = QTableView()
        self.view.setModel(self.proxy)
        self.view.setSortingEnabled(True)
        self.view.setAlternatingRowColors(True)
        self.view.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.view.verticalHeader().hide()
        hh = self.view.horizontalHeader()
        hh.setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        hh.setSectionResizeMode(3, QHeaderView.ResizeMode.Interactive)
        self.view.setAccessibleName("Inventaire des fichiers")
        self.view.selectionModel().currentRowChanged.connect(self._on_select)
        self.search.textChanged.connect(self._apply_filter)
        self.kind_filter.currentIndexChanged.connect(self._apply_filter)

        self.inspector = Card("Inspecteur SQLite", "Sélectionnez une base SQLite pour afficher "
                              "ses tables (copie temporaire, source intacte).", alt=True)
        self.sql_meta = label("", "muted", wrap=True)
        self.inspector.body.addWidget(self.sql_meta)
        self.tables = QListWidget()
        self.tables.setAccessibleName("Tables SQLite")
        self.tables.setMaximumHeight(160)
        self.tables.currentTextChanged.connect(self._preview)
        self.inspector.body.addWidget(self.tables)
        self.preview_table = QTableWidget()
        self.preview_table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self.preview_table.setAccessibleName("Aperçu de la table")
        self.inspector.body.addWidget(self.preview_table, 100)
        self.inspector.body.addStretch(1)  # garde le texte en haut quand l'inspecteur est vide
        self.current_db: Path | None = None
        self._clear_inspector()

        split = QSplitter(Qt.Orientation.Horizontal)
        split.addWidget(self.view)
        split.addWidget(self.inspector)
        split.setStretchFactor(0, 3)
        split.setStretchFactor(1, 2)
        split.setMinimumHeight(460)
        self.content.addWidget(split, 1)

    # -- ouverture -------------------------------------------------------------
    def _choose_dir(self) -> None:
        path = QFileDialog.getExistingDirectory(self, "Ouvrir un dossier",
                                                str(self.state.ctx.default_backup_dir))
        if path:
            self.open(Path(path))

    def _choose_file(self) -> None:
        path, _ = QFileDialog.getOpenFileName(
            self, "Ouvrir un fichier", str(Path.home()),
            "Sauvegardes et bases (*.ab *.db *.sqlite *.sqlite3 *.sqlitedb);;Tous (*)")
        if path:
            self.open(Path(path))

    def open(self, path: Path) -> None:
        if self.worker is not None:
            return
        self.title.setText(f"Chargement de {path.name}…")
        w = Worker(lambda worker: load_source(path))
        w.signals.done.connect(self._on_loaded)
        w.signals.failed.connect(lambda msg: (self.title.setText("Ouverture impossible"),
                                              show_error(self, msg)))
        w.signals.finished.connect(lambda: setattr(self, "worker", None))
        self.worker = start(w)

    def _on_loaded(self, src: LoadedSource) -> None:
        self.loaded = src
        s = src.summary
        self.title.setText(s.path.name or str(s.path))
        self.kind_pill.set(s.kind.value, "warn" if s.encrypted else "ok")
        total = sum(r.size for r in src.records)
        lines = [f"{len(src.records):,} fichier(s) · {human_size(total)}", str(s.path)]
        lines += [f"{k} : {v}" for k, v in s.details.items()]
        self.details.setText("\n".join(lines))
        self.note.setText(src.note)
        self.note.setVisible(bool(src.note))
        self.model.set_records(src.records)
        kinds = sorted({r.kind for r in src.records})
        self.kind_filter.blockSignals(True)
        self.kind_filter.clear()
        self.kind_filter.addItem("Tous les types", "")
        for k in kinds:
            self.kind_filter.addItem(k, k)
        self.kind_filter.blockSignals(False)
        self._apply_filter()
        self.export_btn.setEnabled(True)
        self.extract_btn.setEnabled(bool(src.records))
        self.compare_btn.setEnabled(s.kind is SourceKind.MOBILELAB)
        self.leapp_btn.setEnabled(s.kind in (SourceKind.FOLDER, SourceKind.IOS_BACKUP,
                                             SourceKind.MOBILELAB) and not s.encrypted)
        self._clear_inspector()
        if s.kind is SourceKind.FILE and src.records and src.records[0].kind == "sqlite":
            self._inspect(s.path)

    def _apply_filter(self) -> None:
        self.proxy.set(self.search.text(), self.kind_filter.currentData() or "")
        self.count.setText(f"{self.proxy.rowCount():,} / {self.model.rowCount():,}")

    # -- SQLite ----------------------------------------------------------------
    def _on_select(self, current: QModelIndex, _prev: QModelIndex) -> None:
        if not current.isValid() or self.loaded is None:
            return
        row = self.proxy.mapToSource(current).row()
        record = self.model.records[row]
        local = self.loaded.local[row] if row < len(self.loaded.local) else None
        if record.kind == "sqlite" and local is not None:
            self._inspect(local)

    def _clear_inspector(self) -> None:
        self.current_db = None
        self.tables.clear()
        self.preview_table.clear()
        self.preview_table.setRowCount(0)
        self.preview_table.setColumnCount(0)
        self.sql_meta.setText("")
        self.tables.hide()
        self.preview_table.hide()

    def _inspect(self, db: Path) -> None:
        self._clear_inspector()
        try:
            rep = analysis.inspect_sqlite(db)
        except MobileLabError as exc:
            self.sql_meta.setText(str(exc))
            return
        self.current_db = db
        self.tables.show()
        self.preview_table.show()
        free = (f"{rep.freelist_count} page(s) libre(s) ({rep.free_ratio:.0%}). Des pages libres "
                "peuvent contenir des restes d'enregistrements supprimés, sans garantie : leur "
                "exploitation demande des outils spécialisés.") if rep.freelist_count else \
            "Aucune page libre."
        self.sql_meta.setText(f"{db.name} · {len(rep.tables)} table(s) · journal "
                              f"{rep.journal_mode}{' + WAL' if rep.has_wal else ''}\n{free}")
        for t in rep.tables:
            self.tables.addItem(t.name)
            self.tables.item(self.tables.count() - 1).setToolTip(
                f"{t.row_count} ligne(s) · {', '.join(t.columns)}")

    def _preview(self, table: str) -> None:
        if not table or self.current_db is None:
            return
        try:
            cols, rows = analysis.preview_table(self.current_db, table)
        except MobileLabError as exc:
            self.sql_meta.setText(str(exc))
            return
        self.preview_table.clear()
        self.preview_table.setColumnCount(len(cols))
        self.preview_table.setHorizontalHeaderLabels(cols)
        self.preview_table.setRowCount(len(rows))
        for r, row in enumerate(rows):
            for c, v in enumerate(row):
                self.preview_table.setItem(r, c, QTableWidgetItem("" if v is None else str(v)))

    # -- actions ---------------------------------------------------------------
    def _export(self) -> None:
        if self.loaded is None:
            return
        path, _ = QFileDialog.getSaveFileName(self, "Exporter un rapport",
                                              str(Path.home() / "rapport-mobilelab.html"),
                                              "HTML (*.html);;JSON (*.json);;CSV (*.csv)")
        if not path:
            return
        try:
            export_report(self.loaded.summary, self.loaded.records, Path(path))
        except (OSError, ValueError) as exc:
            show_error(self, f"Export impossible : {exc}")
            return
        self.note.setText(f"Rapport exporté : {path}")
        self.note.show()

    def _selected_rows(self) -> list[int]:
        rows = {self.proxy.mapToSource(i).row() for i in self.view.selectionModel().selectedRows()}
        return sorted(rows)

    def _extract(self) -> None:
        src = self.loaded
        if src is None:
            return
        rows = self._selected_rows()
        if src.summary.kind is not SourceKind.ANDROID_AB and not rows:
            show_error(self, "Sélectionnez un ou plusieurs fichiers dans l'inventaire.")
            return
        dest = QFileDialog.getExistingDirectory(self, "Dossier d'extraction", str(Path.home()))
        if not dest:
            return
        dest_path = Path(dest)

        def job(worker):
            if src.summary.kind is SourceKind.ANDROID_AB:
                done, skipped = analysis.extract_ab(src.summary.path, dest_path)
                return f"{done} fichier(s) extrait(s), {skipped} ignoré(s) (chemin dangereux)."
            n = 0
            for i in rows:
                if src.ios_items is not None:
                    analysis.extract_ios_file(src.summary.path, src.ios_items[i], dest_path)
                else:
                    local = src.local[i]
                    if local is None or not local.exists():
                        continue
                    target = safe_join(dest_path, src.records[i].relative_path)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(local, target)
                n += 1
                worker.report(n, len(rows), src.records[i].relative_path)
            return f"{n} fichier(s) copié(s) vers {dest_path} (sources inchangées)."

        w = Worker(job)
        w.signals.done.connect(lambda msg: (self.note.setText(msg), self.note.show()))
        w.signals.failed.connect(lambda msg: show_error(self, msg))
        w.signals.finished.connect(lambda: setattr(self, "worker", None))
        self.worker = start(w)

    def _compare(self) -> None:
        if self.loaded is None:
            return
        other = QFileDialog.getExistingDirectory(self, "Sauvegarde MobileLab à comparer",
                                                 str(self.loaded.summary.path.parent))
        if not other:
            return
        if not is_mobilelab_backup(Path(other)):
            show_error(self, "Ce dossier n'est pas une sauvegarde MobileLab.")
            return
        d = compare_backups(self.loaded.summary.path, Path(other))
        sample = "\n".join([*(f"+ {p}" for p in d.added[:15]), *(f"- {p}" for p in d.removed[:15]),
                            *(f"~ {p}" for p in d.modified[:15])])
        QMessageBox.information(
            self, "Comparaison",
            f"{len(d.added)} ajouté(s), {len(d.removed)} supprimé(s), {len(d.modified)} "
            f"modifié(s), {d.unchanged} identique(s).\n\n{sample}")

    def _leapp(self) -> None:
        src = self.loaded
        if src is None:
            return
        tool = "ileapp" if src.summary.kind is SourceKind.IOS_BACKUP else "aleapp"
        runner = self.state.ctx.runner
        if not runner.available(tool):
            show_error(self, f"{tool.upper()} n'est pas installé ou introuvable dans le PATH. "
                             "Voir l'onglet Diagnostic.")
            return
        out = QFileDialog.getExistingDirectory(self, f"Dossier de sortie {tool.upper()}",
                                               str(Path.home()))
        if not out:
            return
        source = src.summary.path / "files" if src.summary.kind is SourceKind.MOBILELAB \
            else src.summary.path
        input_type = "itunes" if tool == "ileapp" else "fs"
        w = Worker(lambda worker: run_leapp(runner, tool, input_type, source, Path(out),
                                            worker.emit_line, worker.cancel))
        w.signals.line.connect(lambda ln: self.note.setText(ln[-200:]))
        w.signals.done.connect(lambda p: (self.note.setText(f"{tool.upper()} terminé : {p}"),
                                          self.note.show()))
        w.signals.failed.connect(lambda msg: show_error(self, msg))
        self.note.show()
        w.signals.finished.connect(lambda: setattr(self, "worker", None))
        self.worker = start(w)

