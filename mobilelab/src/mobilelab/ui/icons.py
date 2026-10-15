"""Icônes vectorielles originales (trait 1.75 px, grille 24) colorées à la demande."""

from __future__ import annotations

from functools import lru_cache

from PySide6.QtCore import QByteArray, QRectF, Qt
from PySide6.QtGui import QIcon, QPainter, QPixmap
from PySide6.QtSvg import QSvgRenderer

_PATHS = {
    "devices": '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10.5 18.5h3"/>',
    "backup": '<path d="M12 3v11"/><path d="m7.5 9.5 4.5 4.5 4.5-4.5"/>'
              '<path d="M4 15.5v2A3.5 3.5 0 0 0 7.5 21h9a3.5 3.5 0 0 0 3.5-3.5v-2"/>',
    "analysis": '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5.5 5.5"/>'
                '<path d="M8 10.5h5M10.5 8v5"/>',
    "recovery": '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 4v4.5H8"/>'
                '<path d="M12 8v4.5l3 1.8"/>',
    "diagnostics": '<path d="M3 12h4l2.5-6 5 12 2.5-6h4"/>',
    "logs": '<rect x="4" y="3" width="16" height="18" rx="2.5"/>'
            '<path d="M8 8h8M8 12h8M8 16h5"/>',
    "modules": '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/>'
               '<rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/>'
               '<rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/>'
               '<path d="M17 13.5v7M13.5 17h7"/>',
    "manager": '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/>'
               '<path d="M9.5 8.5h5M9.5 12h5M9.5 15.5h3"/>',
    "android": '<path d="M6 10h12v7.5a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z"/>'
               '<path d="M6.5 9a5.5 5.5 0 0 1 11 0"/><path d="m8 4 1.3 2M16 4l-1.3 2"/>',
    "apple": '<path d="M12 7c1.5-1.3 4.5-1.6 6 .8-2.6 1.6-2.2 5.6.7 6.6-.9 2.6-2.6 5.1-4.3 5.1'
             '-1.3 0-1.6-.8-2.4-.8s-1.2.8-2.4.8C7.4 19.5 4.5 15 4.5 11.5 4.5 7.4 8.7 5.6 12 7z"/>'
             '<path d="M12 7c0-2 1.2-3.6 3-4"/>',
    "refresh": '<path d="M20 11.5A8 8 0 0 0 5.6 6.6L4 8.3"/><path d="M4 4v4.3h4.3"/>'
               '<path d="M4 12.5a8 8 0 0 0 14.4 4.9L20 15.7"/><path d="M20 20v-4.3h-4.3"/>',
    "folder": '<path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2'
              'h-13a2 2 0 0 1-2-2z"/>',
    "shield": '<path d="M12 3 5 6v5.5c0 4.3 3 7.9 7 9.5 4-1.6 7-5.2 7-9.5V6z"/>'
              '<path d="m9 12 2.2 2.2L15.5 10"/>',
    "flask": '<path d="M9.5 3h5M10.5 3v6L5 18.5A1.7 1.7 0 0 0 6.5 21h11a1.7 1.7 0 0 0 1.5-2.5'
             'L13.5 9V3"/><path d="M7.5 15h9"/>',
    "export": '<path d="M12 15V3.5"/><path d="m7.5 8 4.5-4.5L16.5 8"/>'
              '<path d="M4 14v3.5A3.5 3.5 0 0 0 7.5 21h9a3.5 3.5 0 0 0 3.5-3.5V14"/>',
}


def _svg(name: str, color: str) -> bytes:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" '
        f'stroke="{color}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">'
        f"{_PATHS[name]}</svg>"
    ).encode()


@lru_cache(maxsize=256)
def icon(name: str, color: str = "#C9D3DB", size: int = 20) -> QIcon:
    renderer = QSvgRenderer(QByteArray(_svg(name, color)))
    result = QIcon()
    for scale in (1, 2):
        pm = QPixmap(size * scale, size * scale)
        pm.fill(Qt.GlobalColor.transparent)
        painter = QPainter(pm)
        renderer.render(painter, QRectF(0, 0, size * scale, size * scale))
        painter.end()
        pm.setDevicePixelRatio(scale)
        result.addPixmap(pm)
    return result


def names() -> list[str]:
    return list(_PATHS)


_APP_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">'
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
    '<stop offset="0" stop-color="#0F1B24"/><stop offset="1" stop-color="#0B3B36"/>'
    "</linearGradient></defs>"
    '<rect x="8" y="8" width="240" height="240" rx="56" fill="url(#g)"/>'
    '<rect x="78" y="44" width="100" height="168" rx="20" fill="none" stroke="#2CC5A9" '
    'stroke-width="14"/>'
    '<path d="M104 128h18l10-24 14 48 10-24h18" fill="none" stroke="#FFFFFF" stroke-width="12" '
    'stroke-linecap="round" stroke-linejoin="round" transform="translate(-8 0)"/>'
    '<circle cx="128" cy="190" r="7" fill="#2CC5A9"/></svg>'
)


def app_icon() -> QIcon:
    renderer = QSvgRenderer(QByteArray(_APP_SVG.encode()))
    result = QIcon()
    for size in (16, 24, 32, 48, 64, 128, 256):
        pm = QPixmap(size, size)
        pm.fill(Qt.GlobalColor.transparent)
        painter = QPainter(pm)
        renderer.render(painter, QRectF(0, 0, size, size))
        painter.end()
        result.addPixmap(pm)
    return result


def write_app_icon(path: str) -> str:
    """Écrit l'icône de l'application (.ico multi-tailles si Pillow est présent, sinon .png)."""
    import io
    import os

    from PySide6.QtCore import QBuffer, QIODevice
    from PySide6.QtGui import QGuiApplication, QImage

    if QGuiApplication.instance() is None:
        os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
    app = QGuiApplication.instance() or QGuiApplication([])  # noqa: F841 - requis pour peindre
    renderer = QSvgRenderer(QByteArray(_APP_SVG.encode()))
    image = QImage(256, 256, QImage.Format.Format_ARGB32)
    image.fill(Qt.GlobalColor.transparent)
    painter = QPainter(image)
    renderer.render(painter, QRectF(0, 0, 256, 256))
    painter.end()
    buf = QBuffer()
    buf.open(QIODevice.OpenModeFlag.WriteOnly)
    image.save(buf, "PNG")
    png = bytes(buf.data())
    try:
        from PIL import Image
    except ImportError:
        target = os.path.splitext(path)[0] + ".png"
        with open(target, "wb") as fh:
            fh.write(png)
        return target
    Image.open(io.BytesIO(png)).save(path, sizes=[(16, 16), (24, 24), (32, 32), (48, 48),
                                                  (64, 64), (128, 128), (256, 256)])
    return path
