"""Composants d'interface réutilisables."""

from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QFrame,
    QHBoxLayout,
    QLabel,
    QMessageBox,
    QPushButton,
    QScrollArea,
    QVBoxLayout,
    QWidget,
)


def label(text: str = "", role: str | None = None, wrap: bool = False) -> QLabel:
    lb = QLabel(text)
    if role:
        lb.setObjectName(role)
    lb.setWordWrap(wrap)
    lb.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
    return lb


def button(text: str, *, primary: bool = False, danger: bool = False, flat: bool = False,
           tooltip: str = "") -> QPushButton:
    b = QPushButton(text)
    b.setCursor(Qt.CursorShape.PointingHandCursor)
    if primary:
        b.setProperty("primary", True)
    if danger:
        b.setProperty("danger", True)
    if flat:
        b.setProperty("flat", True)
    if tooltip:
        b.setToolTip(tooltip)
    b.setAccessibleName(text)
    return b


class Pill(QLabel):
    """Pastille d'état colorée (ok / warn / error / info / sim)."""

    def __init__(self, text: str = "", level: str = "info") -> None:
        super().__init__(text)
        self.setProperty("pill", True)
        self.set(text, level)

    def set(self, text: str, level: str) -> None:
        self.setText(text)
        self.setProperty("level", level)
        self.setAccessibleName(f"État : {text}")
        self.style().unpolish(self)
        self.style().polish(self)


class Card(QFrame):
    def __init__(self, title: str | None = None, subtitle: str | None = None,
                 alt: bool = False) -> None:
        super().__init__()
        self.setObjectName("cardAlt" if alt else "card")
        self.body = QVBoxLayout(self)
        self.body.setContentsMargins(20, 18, 20, 18)
        self.body.setSpacing(10)
        if title:
            self.body.addWidget(label(title, "h2"))
        if subtitle:
            self.body.addWidget(label(subtitle, "muted", wrap=True))


class Page(QWidget):
    """Page standard : en-tête (titre, sous-titre, actions) + contenu défilant."""

    def __init__(self, title: str, subtitle: str) -> None:
        super().__init__()
        self.setObjectName("page")
        outer = QVBoxLayout(self)
        outer.setContentsMargins(32, 28, 32, 20)
        outer.setSpacing(18)
        head = QHBoxLayout()
        titles = QVBoxLayout()
        titles.setSpacing(2)
        titles.addWidget(label(title, "h1"))
        titles.addWidget(label(subtitle, "sub", wrap=True))
        head.addLayout(titles, 1)
        self.actions = QHBoxLayout()
        self.actions.setSpacing(8)
        head.addLayout(self.actions)
        outer.addLayout(head)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.Shape.NoFrame)
        inner = QWidget()
        inner.setObjectName("page")
        self.content = QVBoxLayout(inner)
        self.content.setContentsMargins(0, 0, 4, 0)
        self.content.setSpacing(16)
        scroll.setWidget(inner)
        outer.addWidget(scroll, 1)


def confirm_destructive(parent: QWidget, title: str, text: str, action: str) -> bool:
    """Confirmation explicite : le bouton par défaut est « Annuler »."""
    box = QMessageBox(parent)
    box.setIcon(QMessageBox.Icon.Warning)
    box.setWindowTitle(title)
    box.setText(text)
    box.setInformativeText("Cette action est irréversible.")
    ok = box.addButton(action, QMessageBox.ButtonRole.DestructiveRole)
    cancel = box.addButton("Annuler", QMessageBox.ButtonRole.RejectRole)
    box.setDefaultButton(cancel)
    box.setEscapeButton(cancel)
    box.exec()
    return box.clickedButton() is ok


def show_error(parent: QWidget, message: str) -> None:
    QMessageBox.warning(parent, "MobileLab", message)


def human_size(n: float) -> str:
    for unit in ("o", "Ko", "Mo", "Go", "To"):
        if abs(n) < 1024 or unit == "To":
            return f"{n:.0f} {unit}" if unit == "o" else f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} To"
