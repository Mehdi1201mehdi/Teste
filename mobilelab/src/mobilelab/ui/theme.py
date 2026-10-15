"""Identité visuelle MobileLab : jetons de couleur, thèmes clair/sombre, feuille de style Qt."""

from __future__ import annotations

import os
from dataclasses import dataclass

from PySide6.QtCore import Qt
from PySide6.QtGui import QColor, QFont, QPalette
from PySide6.QtWidgets import QApplication


@dataclass(frozen=True)
class Palette:
    bg: str
    surface: str
    surface_alt: str
    sidebar: str
    ink: str
    muted: str
    line: str
    accent: str
    accent_ink: str
    accent_soft: str
    ok: str
    warn: str
    danger: str
    sim: str
    sim_soft: str
    focus: str


LIGHT = Palette(
    bg="#F4F5F7", surface="#FFFFFF", surface_alt="#F8F9FB", sidebar="#0F1B24",
    ink="#141820", muted="#5A6273", line="#E1E4EA",
    accent="#0B7A6A", accent_ink="#FFFFFF", accent_soft="#E3F3F0",
    ok="#15803D", warn="#B45309", danger="#B91C1C", sim="#6D28D9", sim_soft="#EFE7FD",
    focus="#2563EB",
)
DARK = Palette(
    bg="#0E1014", surface="#161920", surface_alt="#1B1F27", sidebar="#0A1218",
    ink="#E8EBF1", muted="#9AA2B4", line="#262B35",
    accent="#2CC5A9", accent_ink="#06231E", accent_soft="#123A34",
    ok="#4ADE80", warn="#FBBF24", danger="#F87171", sim="#A78BFA", sim_soft="#2A2145",
    focus="#60A5FA",
)

# La barre latérale reste sombre dans les deux thèmes : repère visuel stable.
SIDEBAR_INK = "#C9D3DB"
SIDEBAR_MUTED = "#7F8D99"


def current_palette(app: QApplication) -> Palette:
    forced = os.environ.get("MOBILELAB_THEME", "").lower()
    if forced in ("dark", "light"):
        return DARK if forced == "dark" else LIGHT
    try:
        dark = app.styleHints().colorScheme() == Qt.ColorScheme.Dark
    except AttributeError:  # Qt < 6.5
        dark = app.palette().color(QPalette.ColorRole.Window).lightness() < 128
    return DARK if dark else LIGHT


def build_qss(p: Palette) -> str:
    return f"""
* {{ outline: none; }}
QWidget {{ color: {p.ink}; font-size: 13px; }}
QMainWindow, #page {{ background: {p.bg}; }}
QToolTip {{ background: {p.ink}; color: {p.bg}; border: none; padding: 6px 8px; }}

/* Barre latérale */
#sidebar {{ background: {p.sidebar}; }}
#brand {{ color: #FFFFFF; font-size: 17px; font-weight: 700; letter-spacing: 0.3px; }}
#brandTag {{ color: {SIDEBAR_MUTED}; font-size: 11px; }}
#nav {{ background: transparent; border: none; }}
#nav::item {{ color: {SIDEBAR_INK}; padding: 9px 12px; margin: 2px 10px; border-radius: 8px; }}
#nav::item:hover {{ background: rgba(255,255,255,0.06); }}
#nav::item:selected {{ background: rgba(44,197,169,0.16); color: #FFFFFF; }}
#nav:focus {{ border: none; }}
#nav::item:focus {{ border: 1px solid {p.focus}; }}
#sidebarFoot {{ color: {SIDEBAR_MUTED}; font-size: 11px; }}

/* Typographie */
#h1 {{ font-size: 22px; font-weight: 700; }}
#h2 {{ font-size: 15px; font-weight: 650; }}
#sub, #muted {{ color: {p.muted}; }}
#kpi {{ font-size: 20px; font-weight: 700; }}

/* Cartes */
#card {{ background: {p.surface}; border: 1px solid {p.line}; border-radius: 12px; }}
#cardAlt {{ background: {p.surface_alt}; border: 1px solid {p.line}; border-radius: 10px; }}
#banner {{ background: {p.sim_soft}; border: 1px solid {p.sim}; border-radius: 10px; }}
#banner QLabel {{ color: {p.sim}; font-weight: 600; }}
#notice {{ background: {p.accent_soft}; border-radius: 10px; }}

/* Pastilles d'état */
QLabel[pill="true"] {{ border-radius: 10px; padding: 2px 10px; font-size: 12px; font-weight: 600; }}
QLabel[level="ok"] {{ color: {p.ok}; border: 1px solid {p.ok}; }}
QLabel[level="warn"] {{ color: {p.warn}; border: 1px solid {p.warn}; }}
QLabel[level="error"] {{ color: {p.danger}; border: 1px solid {p.danger}; }}
QLabel[level="info"] {{ color: {p.muted}; border: 1px solid {p.line}; }}
QLabel[level="sim"] {{ color: {p.sim}; border: 1px solid {p.sim}; }}

/* Boutons */
QPushButton {{ background: {p.surface}; border: 1px solid {p.line}; border-radius: 8px;
    padding: 7px 14px; font-weight: 600; }}
QPushButton:hover {{ border-color: {p.muted}; }}
QPushButton:focus {{ border: 2px solid {p.focus}; padding: 6px 13px; }}
QPushButton:disabled {{ color: {p.muted}; background: {p.surface_alt}; }}
QPushButton[primary="true"] {{ background: {p.accent}; color: {p.accent_ink}; border: 1px solid {p.accent}; }}
QPushButton[primary="true"]:disabled {{ background: {p.line}; border-color: {p.line}; color: {p.muted}; }}
QPushButton[danger="true"] {{ color: {p.danger}; }}
QPushButton[flat="true"] {{ background: transparent; border: none; color: {p.accent}; }}

/* Champs */
QLineEdit, QComboBox, QPlainTextEdit, QSpinBox {{ background: {p.surface}; border: 1px solid {p.line};
    border-radius: 8px; padding: 6px 8px; selection-background-color: {p.accent}; }}
QLineEdit:focus, QComboBox:focus, QPlainTextEdit:focus {{ border: 2px solid {p.focus}; padding: 5px 7px; }}
QComboBox::drop-down {{ border: none; width: 22px; }}
QComboBox QAbstractItemView {{ background: {p.surface}; border: 1px solid {p.line};
    selection-background-color: {p.accent_soft}; selection-color: {p.ink}; }}
QCheckBox {{ spacing: 8px; }}
QCheckBox::indicator {{ width: 16px; height: 16px; border-radius: 4px; border: 1px solid {p.muted};
    background: {p.surface}; }}
QCheckBox::indicator:checked {{ background: {p.accent}; border-color: {p.accent}; }}
QCheckBox:focus {{ color: {p.focus}; }}

/* Listes et tableaux */
QListWidget, QTableView, QTreeView {{ background: {p.surface}; border: 1px solid {p.line};
    border-radius: 10px; alternate-background-color: {p.surface_alt}; gridline-color: {p.line}; }}
QListWidget#deviceList {{ border: none; background: transparent; }}
QListWidget#deviceList::item {{ border: none; margin: 0 0 8px 0; }}
QListWidget#deviceList::item:selected {{ background: transparent; }}
QTableView::item:selected, QTreeView::item:selected, QListWidget::item:selected {{
    background: {p.accent_soft}; color: {p.ink}; }}
QHeaderView::section {{ background: {p.surface_alt}; color: {p.muted}; border: none;
    border-bottom: 1px solid {p.line}; padding: 6px 8px; font-weight: 600; }}
QTableView:focus, QListWidget:focus, QTreeView:focus {{ border: 2px solid {p.focus}; }}

QProgressBar {{ background: {p.line}; border: none; border-radius: 4px; height: 8px; text-align: center;
    color: transparent; }}
QProgressBar::chunk {{ background: {p.accent}; border-radius: 4px; }}

QScrollArea {{ border: none; background: transparent; }}
QScrollBar:vertical {{ background: transparent; width: 10px; margin: 2px; }}
QScrollBar::handle:vertical {{ background: {p.line}; border-radius: 4px; min-height: 30px; }}
QScrollBar::add-line, QScrollBar::sub-line {{ height: 0; }}
QSplitter::handle {{ background: transparent; }}
QStatusBar {{ background: {p.surface}; border-top: 1px solid {p.line}; color: {p.muted}; }}
QTabWidget::pane {{ border: none; }}
QTabBar::tab {{ padding: 8px 14px; color: {p.muted}; border-bottom: 2px solid transparent; }}
QTabBar::tab:selected {{ color: {p.ink}; border-bottom: 2px solid {p.accent}; }}
"""


def apply_theme(app: QApplication) -> Palette:
    p = current_palette(app)
    font = QFont()
    font.setFamilies(["Inter", "Segoe UI Variable", "Segoe UI", "SF Pro Text", "Cantarell",
                      "Noto Sans", "sans-serif"])
    font.setPointSizeF(10)
    app.setFont(font)
    pal = app.palette()
    pal.setColor(QPalette.ColorRole.Window, QColor(p.bg))
    pal.setColor(QPalette.ColorRole.Base, QColor(p.surface))
    pal.setColor(QPalette.ColorRole.Text, QColor(p.ink))
    pal.setColor(QPalette.ColorRole.WindowText, QColor(p.ink))
    pal.setColor(QPalette.ColorRole.Highlight, QColor(p.accent))
    pal.setColor(QPalette.ColorRole.HighlightedText, QColor(p.accent_ink))
    app.setPalette(pal)
    app.setStyleSheet(build_qss(p))
    return p
