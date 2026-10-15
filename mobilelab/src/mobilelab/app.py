"""Point d'entrée de l'application graphique."""

from __future__ import annotations

import argparse
import sys

from mobilelab import APP_NAME, __version__


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="mobilelab", description=f"{APP_NAME} {__version__}")
    parser.add_argument("--simulation", action="store_true",
                        help="démarrer avec des appareils simulés (démo, aucune donnée réelle)")
    args = parser.parse_args(argv)

    from PySide6.QtCore import QThreadPool
    from PySide6.QtWidgets import QApplication

    from mobilelab.context import build_context
    from mobilelab.core.logging_setup import get_logger
    from mobilelab.ui.icons import app_icon
    from mobilelab.ui.main_window import MainWindow
    from mobilelab.ui.state import AppState
    from mobilelab.ui.theme import apply_theme

    app = QApplication(sys.argv[:1])
    app.setApplicationName(APP_NAME)
    app.setApplicationVersion(__version__)
    app.setOrganizationName(APP_NAME)
    apply_theme(app)
    app.setWindowIcon(app_icon())
    try:
        app.styleHints().colorSchemeChanged.connect(lambda _s: apply_theme(app))
    except AttributeError:  # Qt < 6.5
        pass

    ctx = build_context(simulation=args.simulation)
    get_logger("app").info("Démarrage %s %s (données : %s)", APP_NAME, __version__, ctx.data_dir)
    window = MainWindow(AppState(ctx))
    window.show()
    code = app.exec()
    QThreadPool.globalInstance().waitForDone(3000)
    ctx.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
