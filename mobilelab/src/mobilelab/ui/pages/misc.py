"""Pages Récupération, Diagnostic, Journal et Modules."""

from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path

from PySide6.QtCore import QObject, Qt, QUrl, Signal
from PySide6.QtGui import QDesktopServices, QFontDatabase
from PySide6.QtWidgets import (
    QComboBox,
    QFileDialog,
    QGridLayout,
    QHBoxLayout,
    QMessageBox,
    QPlainTextEdit,
    QProgressBar,
)

from mobilelab.core.errors import MobileLabError
from mobilelab.core.modules import Maturity, modules
from mobilelab.services import tools_install
from mobilelab.services.devices import ANDROID_SETUP_STEPS
from mobilelab.services.diagnostics import Check, export_bundle, restart_adb_server, run_checks
from mobilelab.ui.state import AppState
from mobilelab.ui.widgets import Card, Page, Pill, button, label, show_error
from mobilelab.ui.workers import Worker, start


class RecoveryPage(Page):
    """Présente honnêtement ce qui est récupérable, et oriente vers l'extraction."""

    def __init__(self, state: AppState) -> None:
        super().__init__("Récupération",
                         "Retrouver des données à partir de ce qui existe encore : fichiers "
                         "présents, sauvegardes locales et bases accessibles.")
        grid = QGridLayout()
        grid.setSpacing(16)
        can = Card("Ce que MobileLab peut faire")
        for t in ("Copier les fichiers encore présents dans le stockage partagé Android.",
                  "Extraire des fichiers d'une sauvegarde iOS non chiffrée (format Finder/"
                  "iTunes) ou d'une sauvegarde Android .ab non chiffrée.",
                  "Lire les bases SQLite (messages, notes…) présentes dans une sauvegarde, "
                  "en lecture seule, et signaler les pages libres qu'elles contiennent.",
                  "Comparer deux sauvegardes pour repérer les fichiers disparus."):
            can.body.addWidget(label("✓  " + t, wrap=True))
        cannot = Card("Ce qui n'est pas possible ici")
        for t in ("Garantir la récupération de fichiers supprimés : sur les téléphones "
                  "récents, le stockage est chiffré et l'espace libéré est rapidement réutilisé.",
                  "Lire une sauvegarde chiffrée sans son mot de passe, ou contourner un "
                  "verrouillage, un compte Google/Apple (FRP, verrouillage d'activation).",
                  "Accéder aux données privées des applications Android sans root."):
            cannot.body.addWidget(label("✕  " + t, wrap=True))
        grid.addWidget(can, 0, 0)
        grid.addWidget(cannot, 0, 1)
        self.content.addLayout(grid)

        tips = Card("Pour maximiser vos chances")
        for i, t in enumerate((
                "Arrêtez d'utiliser l'appareil : chaque écriture peut écraser des données.",
                "Vérifiez d'abord la corbeille des applications (Photos, Fichiers, Google Photos, "
                "iCloud « Supprimés récemment »).",
                "Cherchez une sauvegarde existante (ordinateur, cloud) et ouvrez-la dans Analyse.",
                "Travaillez toujours sur une copie : MobileLab n'écrit jamais dans la source."), 1):
            tips.body.addWidget(label(f"{i}. {t}", wrap=True))
        go = button("Ouvrir une sauvegarde dans Analyse", primary=True)
        go.clicked.connect(lambda: state.navigate.emit("analysis"))
        tips.body.addWidget(go, 0, Qt.AlignmentFlag.AlignLeft)
        self.content.addWidget(tips)
        self.content.addStretch(1)


_LEVEL_TEXT = {"ok": "OK", "warn": "Attention", "error": "Erreur", "info": "Info"}


class DiagnosticsPage(Page):
    def __init__(self, state: AppState) -> None:
        super().__init__("Diagnostic",
                         "État des outils et services nécessaires, avec la marche à suivre "
                         "en cas de problème.")
        self.state = state
        self.checks: list[Check] = []
        self.worker: Worker | None = None
        run = button("Relancer le diagnostic", primary=True)
        run.clicked.connect(self.run)
        adb = button("Redémarrer le serveur ADB")
        adb.clicked.connect(self._restart_adb)
        export = button("Exporter un pack de support…")
        export.setToolTip("Archive ZIP : diagnostic + journal (secrets masqués)")
        export.clicked.connect(self._export)
        for b in (export, adb, run):
            self.actions.addWidget(b)
        self.content.addWidget(self._tools_card())
        self.results = Card("Résultats")
        self.content.addWidget(self.results)
        steps = Card("Activer le débogage USB (Android)")
        for i, s in enumerate(ANDROID_SETUP_STEPS, 1):
            steps.body.addWidget(label(f"{i}. {s}", wrap=True))
        self.content.addWidget(steps)
        self.content.addStretch(1)
        self._rows: list = []

    # -- outils ---------------------------------------------------------------
    def _tools_card(self) -> Card:
        card = Card("Outils", "Installation automatique dans le dossier de MobileLab, depuis les "
                    "sources officielles, après votre accord. Ou indiquez un exécutable existant.")
        row = QHBoxLayout()
        adb = button("Installer / mettre à jour ADB", primary=True)
        adb.setToolTip("Télécharge Android Platform-Tools depuis dl.google.com")
        adb.clicked.connect(self._install_adb)
        row.addWidget(adb)
        if sys.platform == "win32":
            apple = button("Installer les outils Apple (iPhone)")
            apple.setToolTip("Télécharge libimobiledevice pour Windows (projet open source)")
            apple.clicked.connect(self._install_apple)
            row.addWidget(apple)
        row.addStretch(1)
        card.body.addLayout(row)
        self.tool_progress = QProgressBar()
        self.tool_progress.hide()
        card.body.addWidget(self.tool_progress)
        pick = QHBoxLayout()
        self.tool_combo = QComboBox()
        self.tool_combo.setAccessibleName("Outil à configurer")
        for tool in ("adb", "idevice_id", "ideviceinfo", "idevicebackup2", "aleapp", "ileapp"):
            self.tool_combo.addItem(tool, tool)
        self.tool_combo.currentIndexChanged.connect(self._show_tool_path)
        choose = button("Choisir l'exécutable…")
        choose.clicked.connect(self._choose_tool)
        reset = button("Détection automatique", flat=True)
        reset.clicked.connect(lambda: self._set_tool(None))
        pick.addWidget(self.tool_combo)
        pick.addWidget(choose)
        pick.addWidget(reset)
        pick.addStretch(1)
        card.body.addLayout(pick)
        self.tool_path = label("", "muted", wrap=True)
        card.body.addWidget(self.tool_path)
        self._show_tool_path()
        return card

    def _show_tool_path(self) -> None:
        tool = self.tool_combo.currentData()
        runner = self.state.ctx.runner
        found = runner.resolve(tool)
        origin = "choisi manuellement" if runner.override(tool) else "détection automatique"
        self.tool_path.setText(f"{tool} : {found or 'introuvable'} ({origin})")

    def _choose_tool(self) -> None:
        tool = self.tool_combo.currentData()
        flt = f"{tool}.exe ({tool}.exe);;Tous (*)" if sys.platform == "win32" else "Tous (*)"
        path, _ = QFileDialog.getOpenFileName(self, f"Exécutable {tool}", str(Path.home()), flt)
        if path:
            self._set_tool(path)

    def _set_tool(self, path: str | None) -> None:
        self.state.ctx.set_tool_path(self.tool_combo.currentData(), path)
        self._show_tool_path()
        self.state.scan()
        self.run()

    def _consent(self, what: str, source: str) -> bool:
        answer = QMessageBox.question(
            self, "Téléchargement",
            f"MobileLab va télécharger {what} depuis {source} et l'installer dans son dossier "
            f"({self.state.ctx.tools_dir}).\n\nAucune donnée n'est envoyée. Continuer ?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No)
        return answer == QMessageBox.StandardButton.Yes

    def _install_adb(self) -> None:
        if not self._consent("Android Platform-Tools (ADB) — en l'utilisant, vous acceptez les "
                             "conditions de licence du SDK Android de Google",
                             "dl.google.com (site officiel de Google)"):
            return
        ctx = self.state.ctx

        def job(worker):
            if ctx.runner.available("adb"):  # libère adb.exe avant remplacement
                try:
                    ctx.runner.run("adb", ["kill-server"], timeout=15)
                except MobileLabError:
                    pass
            return tools_install.install_platform_tools(ctx.tools_dir, consent=True,
                                                        progress=worker.report)
        self._run_install(job, "ADB")

    def _install_apple(self) -> None:
        if not self._consent("les outils libimobiledevice pour Windows (logiciel libre)",
                             "GitHub (projet libimobiledevice-win32)"):
            return
        ctx = self.state.ctx
        self._run_install(lambda worker: tools_install.install_imobiledevice_windows(
            ctx.tools_dir, consent=True, progress=worker.report), "Outils Apple")

    def _run_install(self, job, name: str) -> None:
        w = Worker(job)
        w.signals.progress.connect(lambda d, t, m: (
            self.tool_progress.setRange(0, t or 0), self.tool_progress.setValue(d),
            self.tool_path.setText(m)))
        w.signals.done.connect(lambda path: (
            QMessageBox.information(self, "MobileLab", f"{name} installé :\n{path}"),
            self._show_tool_path(), self.state.scan(), self.run()))
        w.signals.failed.connect(lambda msg: show_error(self, f"{name} : {msg}"))
        w.signals.finished.connect(self.tool_progress.hide)
        self.tool_progress.setRange(0, 0)
        self.tool_progress.show()
        self._install_worker = start(w)

    def run(self) -> None:
        if self.worker is not None:
            return
        ctx = self.state.ctx
        w = Worker(lambda worker: run_checks(ctx.runner, ctx.data_dir))
        w.signals.done.connect(self._show)
        w.signals.failed.connect(lambda msg: show_error(self, msg))
        w.signals.finished.connect(lambda: setattr(self, "worker", None))
        self.worker = start(w)

    def _show(self, checks: list[Check]) -> None:
        self.checks = checks
        for row in self._rows:
            row.deleteLater()
        self._rows = []
        for c in checks:
            row = Card(alt=True)
            head = QHBoxLayout()
            head.addWidget(label(c.name, "h2"), 1)
            head.addWidget(Pill(_LEVEL_TEXT[c.level.value], c.level.value))
            row.body.addLayout(head)
            row.body.addWidget(label(c.detail, "muted", wrap=True))
            if c.hint:
                row.body.addWidget(label("→ " + c.hint, wrap=True))
            self.results.body.addWidget(row)
            self._rows.append(row)

    def _restart_adb(self) -> None:
        runner = self.state.ctx.runner
        w = Worker(lambda worker: restart_adb_server(runner))
        w.signals.done.connect(lambda msg: (self.state.scan(), self.run()))
        w.signals.failed.connect(lambda msg: show_error(self, msg))
        start(w)
        self._restart_worker = w

    def _export(self) -> None:
        stamp = datetime.now().strftime("%Y%m%d-%H%M")
        path, _ = QFileDialog.getSaveFileName(
            self, "Pack de support", str(Path.home() / f"mobilelab-support-{stamp}.zip"),
            "Archive ZIP (*.zip)")
        if path:
            export_bundle(self.checks, self.state.ctx.log_buffer.lines(), Path(path))


class _LogBridge(QObject):
    line = Signal(str)


class LogsPage(Page):
    def __init__(self, state: AppState) -> None:
        super().__init__("Journal", "Historique détaillé des opérations. Les mots de passe et "
                         "jetons sont masqués automatiquement.")
        self.state = state
        self.level = QComboBox()
        self.level.setAccessibleName("Niveau minimal")
        for text, key in (("Tout", ""), ("Infos et plus", "INFO"), ("Avertissements", "WARNING"),
                          ("Erreurs", "ERROR")):
            self.level.addItem(text, key)
        self.level.currentIndexChanged.connect(self._reload)
        folder = button("Ouvrir le dossier des journaux")
        folder.clicked.connect(lambda: QDesktopServices.openUrl(
            QUrl.fromLocalFile(str(state.ctx.data_dir / "logs"))))
        export = button("Exporter…")
        export.clicked.connect(self._export)
        for w in (self.level, folder, export):
            self.actions.addWidget(w)
        self.text = QPlainTextEdit()
        self.text.setReadOnly(True)
        self.text.setMaximumBlockCount(5000)
        self.text.setFont(QFontDatabase.systemFont(QFontDatabase.SystemFont.FixedFont))
        self.text.setAccessibleName("Journal")
        self.text.setMinimumHeight(480)
        self.content.addWidget(self.text, 1)
        self.history = Card("Opérations récentes", alt=True)
        self.history_label = label("", "muted", wrap=True)
        self.history.body.addWidget(self.history_label)
        self.content.addWidget(self.history)
        self.bridge = _LogBridge()
        self.bridge.line.connect(self._append)  # file d'attente Qt : sûr entre threads
        state.ctx.log_buffer.subscribe(self.bridge.line.emit)
        self._reload()

    _ORDER = {"DEBUG": 0, "INFO": 1, "WARNING": 2, "ERROR": 3, "CRITICAL": 4}

    def _keep(self, line: str) -> bool:
        wanted = self.level.currentData()
        if not wanted:
            return True
        parts = line.split()
        lvl = parts[2] if len(parts) > 2 else ""
        return self._ORDER.get(lvl, 1) >= self._ORDER[wanted]

    def _append(self, line: str) -> None:
        if self._keep(line):
            self.text.appendPlainText(line)

    def _reload(self) -> None:
        self.text.setPlainText("\n".join(ln for ln in self.state.ctx.log_buffer.lines()
                                         if self._keep(ln)))
        ops = self.state.ctx.store.recent_operations(10)
        self.history_label.setText("\n".join(
            f"{o['started_at'][:16].replace('T', ' ')}  {o['kind']:<16} {o['status']:<8} "
            f"{o['summary']}" for o in ops) or "Aucune opération pour l'instant.")

    def showEvent(self, event) -> None:  # noqa: N802 - API Qt
        self._reload()
        super().showEvent(event)

    def _export(self) -> None:
        path, _ = QFileDialog.getSaveFileName(self, "Exporter le journal",
                                              str(Path.home() / "mobilelab.log"), "Journal (*.log)")
        if path:
            Path(path).write_text("\n".join(self.state.ctx.log_buffer.lines()), encoding="utf-8")


_MATURITY_LEVEL = {Maturity.STABLE: "ok", Maturity.EXPERIMENTAL: "warn", Maturity.PLANNED: "info"}


class ModulesPage(Page):
    def __init__(self, state: AppState) -> None:
        super().__init__("Modules", "Fonctions additionnelles et feuille de route. Un module "
                         "prévu n'est jamais simulé : il apparaît ici tant qu'il n'est pas validé.")
        for m in modules():
            card = Card(alt=True)
            head = QHBoxLayout()
            head.addWidget(label(m.title, "h2"), 1)
            head.addWidget(Pill(m.maturity.value, _MATURITY_LEVEL[m.maturity]))
            card.body.addLayout(head)
            card.body.addWidget(label(m.description, "muted", wrap=True))
            self.content.addWidget(card)
        self.content.addStretch(1)
