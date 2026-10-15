"""Exécution des tâches longues hors du fil de l'interface."""

from __future__ import annotations

import threading
import traceback
from collections.abc import Callable
from typing import Any

from PySide6.QtCore import QObject, QRunnable, QThreadPool, Signal

from mobilelab.core.errors import MobileLabError
from mobilelab.core.logging_setup import get_logger

log = get_logger("ui.worker")


class WorkerSignals(QObject):
    progress = Signal(int, int, str)
    line = Signal(str)
    done = Signal(object)
    failed = Signal(str)
    finished = Signal()


class Worker(QRunnable):
    """Exécute `fn(*args, worker=self, **kwargs)` dans le pool de threads Qt.

    La fonction peut appeler `worker.report(...)`, `worker.emit_line(...)` et
    consulter `worker.cancel` (threading.Event).
    """

    def __init__(self, fn: Callable[..., Any], *args: Any, **kwargs: Any) -> None:
        super().__init__()
        self.fn, self.args, self.kwargs = fn, args, kwargs
        self.signals = WorkerSignals()
        self.cancel = threading.Event()

    def report(self, done: int, total: int, message: str) -> None:
        self.signals.progress.emit(done, total, message)

    def emit_line(self, text: str) -> None:
        self.signals.line.emit(text)

    def run(self) -> None:
        try:
            result = self.fn(*self.args, worker=self, **self.kwargs)
        except MobileLabError as exc:
            self.signals.failed.emit(str(exc))
        except Exception as exc:  # noqa: BLE001 - toute erreur doit remonter à l'UI
            log.error("Erreur inattendue : %s\n%s", exc, traceback.format_exc())
            self.signals.failed.emit(f"Erreur inattendue : {exc}")
        else:
            self.signals.done.emit(result)
        finally:
            self.signals.finished.emit()


def start(worker: Worker) -> Worker:
    QThreadPool.globalInstance().start(worker)
    return worker
