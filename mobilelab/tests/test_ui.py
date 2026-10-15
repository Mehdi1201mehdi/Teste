"""Tests de fumée de l'interface (Qt hors écran, mode simulation)."""

from __future__ import annotations

import os
import time
from pathlib import Path

import pytest

pytest.importorskip("PySide6.QtWidgets")

from PySide6.QtCore import QThreadPool  # noqa: E402
from PySide6.QtWidgets import QApplication  # noqa: E402

from mobilelab.context import build_context  # noqa: E402
from mobilelab.ui.main_window import NAV, MainWindow  # noqa: E402
from mobilelab.ui.state import AppState  # noqa: E402
from mobilelab.ui.theme import apply_theme  # noqa: E402


def wait_until(predicate, timeout: float = 10.0) -> None:
    app = QApplication.instance()
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        app.processEvents()
        if predicate():
            return
        time.sleep(0.01)
    raise AssertionError("Condition non atteinte à temps")


@pytest.fixture(scope="module")
def qapp():
    app = QApplication.instance() or QApplication([])
    apply_theme(app)
    return app


@pytest.fixture
def window(qapp, tmp_path):
    ctx = build_context(simulation=True, data_dir=tmp_path / "data")
    state = AppState(ctx)
    win = MainWindow(state)
    win.pages["backup"].dest.setText(str(tmp_path / "backups"))
    win.show()
    yield win
    win.close()
    QThreadPool.globalInstance().waitForDone(5000)
    ctx.close()


def test_simulation_flow(window, tmp_path):
    state = window.state
    wait_until(lambda: len(state.devices) == 3)
    assert window.banner_holder.isVisible()
    assert "SIMULATION" in window.windowTitle()
    assert window.pages["devices"].list.count() == 3

    for i in range(len(NAV)):  # chaque page s'affiche sans erreur
        window.nav.setCurrentRow(i)
        QApplication.processEvents()

    shots = os.environ.get("MOBILELAB_SCREENSHOTS")
    if shots:
        window.nav.setCurrentRow(0)
        QApplication.processEvents()
        window.grab().save(str(Path(shots) / "01-appareils.png"))

    # Sauvegarde Android simulée depuis l'interface
    page = window.pages["backup"]
    window.go("backup")
    page.device_combo.setCurrentIndex(0)
    assert page.start_btn.isEnabled()
    page._start()
    wait_until(lambda: page.worker is None and "Terminé" in page.status.text())
    assert page.table.rowCount() == 1
    if shots:
        QApplication.processEvents()
        window.grab().save(str(Path(shots) / "02-sauvegarde.png"))

    # Analyse de la sauvegarde produite
    [backup_dir] = list((tmp_path / "backups").iterdir())
    window.go(f"analysis:{backup_dir}")
    analysis = window.pages["analysis"]
    wait_until(lambda: analysis.loaded is not None)
    assert analysis.model.rowCount() > 0
    assert "SIMULATION" in analysis.note.text()
    analysis.search.setText("IMG_0001")
    assert analysis.proxy.rowCount() == 1
    if shots:
        analysis.search.setText("")
        QApplication.processEvents()
        window.grab().save(str(Path(shots) / "03-analyse.png"))

    window.go("diagnostics")
    diag = window.pages["diagnostics"]
    wait_until(lambda: bool(diag.checks))
    if shots:
        QApplication.processEvents()
        window.grab().save(str(Path(shots) / "04-diagnostic.png"))
        window.go("recovery")
        QApplication.processEvents()
        window.grab().save(str(Path(shots) / "05-recuperation.png"))


def test_toggle_simulation_off(window):
    state = window.state
    wait_until(lambda: len(state.devices) == 3)
    window.sim_toggle.setChecked(False)
    assert not state.simulation
    assert not window.banner_holder.isVisible()


def test_sqlite_inspector(window, tmp_path):
    from tests.conftest import make_sqlite

    folder = tmp_path / "src"
    folder.mkdir()
    make_sqlite(folder / "sms.db", rows=4)
    page = window.pages["analysis"]
    window.go(f"analysis:{folder}")
    wait_until(lambda: page.loaded is not None)
    page.view.selectRow(0)
    wait_until(lambda: page.tables.count() == 1)
    page.tables.setCurrentRow(0)
    assert page.preview_table.rowCount() == 4
    assert page.preview_table.horizontalHeaderItem(1).text() == "body"


def test_manager_page(window, tmp_path, monkeypatch):
    import mobilelab.ui.pages.manager as manager_page

    monkeypatch.setattr(manager_page, "default_capture_dir", lambda: tmp_path / "captures")
    state = window.state
    wait_until(lambda: len(state.devices) == 3)
    window.go("manager")
    page = window.pages["manager"]
    wait_until(lambda: page.apps_table.rowCount() == 3 and page.worker is None)
    page.app_filter.setText("photos")
    visible = [r for r in range(3) if not page.apps_table.isRowHidden(r)]
    assert len(visible) == 1
    page.app_filter.setText("")
    page._screenshot()
    wait_until(lambda: page.worker is None and "Capture enregistrée" in page.status.text())
    assert list((tmp_path / "captures").glob("capture_*.png"))
    shots = os.environ.get("MOBILELAB_SCREENSHOTS")
    if shots:
        QApplication.processEvents()
        window.grab().save(str(Path(shots) / "06-gestion.png"))
        window.go("diagnostics")
        wait_until(lambda: bool(window.pages["diagnostics"].checks))
        QApplication.processEvents()
        window.grab().save(str(Path(shots) / "04-diagnostic.png"))
