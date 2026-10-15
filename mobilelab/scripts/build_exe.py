"""Construit un exécutable autonome avec PyInstaller pour le système courant.

Usage :  python scripts/build_exe.py [--onefile]
Résultat : dist/MobileLab/ (dossier) ou dist/MobileLab[.exe] (fichier unique).

PyInstaller ne fait pas de compilation croisée : construisez sur Windows pour Windows,
sur macOS pour macOS, sur Linux pour Linux. ADB et libimobiledevice ne sont pas embarqués
(licences et pilotes propres à chaque système) : ils restent des prérequis à installer.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--onefile", action="store_true",
                        help="un seul fichier (démarrage plus lent)")
    args = parser.parse_args()
    try:
        import PyInstaller.__main__ as pyinstaller
    except ImportError:
        print("PyInstaller manquant : pip install -e .[build]", file=sys.stderr)
        return 1
    opts = [
        str(ROOT / "src" / "mobilelab" / "__main__.py"),
        "--name", "MobileLab",
        "--noconfirm",
        "--clean",
        "--windowed",
        "--paths", str(ROOT / "src"),
        "--distpath", str(ROOT / "dist"),
        "--workpath", str(ROOT / "build"),
        "--specpath", str(ROOT / "build"),
        # Modules Qt inutiles : exécutable plus léger.
        *[arg for m in ("PySide6.QtWebEngineCore", "PySide6.QtWebEngineWidgets",
                        "PySide6.Qt3DCore", "PySide6.QtQuick", "PySide6.QtQml",
                        "PySide6.QtMultimedia", "PySide6.QtCharts", "PySide6.QtPdf",
                        "tkinter")
          for arg in ("--exclude-module", m)],
    ]
    if args.onefile:
        opts.append("--onefile")
    pyinstaller.run(opts)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
