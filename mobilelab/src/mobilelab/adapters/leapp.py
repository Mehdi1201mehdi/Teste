"""Adaptateurs facultatifs vers ALEAPP / iLEAPP (Alexis Brignoni, licence MIT).

MobileLab ne les embarque pas : l'utilisateur les installe et indique leur exécutable.
La syntaxe `-t <type> -i <entrée> -o <sortie>` correspond à leur README ; elle doit être
revérifiée à chaque montée de version de ces outils.
"""

from __future__ import annotations

import threading
from pathlib import Path

from mobilelab.adapters.base import LineCallback
from mobilelab.core.errors import CommandError, UnsafePathError
from mobilelab.core.runner import CommandRunner

INPUT_TYPES = {
    "aleapp": ("fs", "tar", "zip", "gz"),
    "ileapp": ("fs", "tar", "zip", "gz", "itunes"),
}


def run_leapp(
    runner: CommandRunner,
    tool: str,
    input_type: str,
    source: Path,
    output_dir: Path,
    on_line: LineCallback,
    cancel: threading.Event | None = None,
) -> Path:
    if tool not in INPUT_TYPES:
        raise UnsafePathError(f"Outil inconnu : {tool}")
    if input_type not in INPUT_TYPES[tool]:
        raise UnsafePathError(f"Type d'entrée non pris en charge par {tool} : {input_type}")
    if not source.exists():
        raise UnsafePathError(f"Source introuvable : {source}")
    output_dir.mkdir(parents=True, exist_ok=True)
    code = runner.stream(
        tool, ["-t", input_type, "-i", str(source.resolve()), "-o", str(output_dir.resolve())],
        on_line, cancel=cancel, timeout=6 * 3600,
    )
    if code != 0:
        raise CommandError(f"{tool} a terminé avec le code {code}.")
    return output_dir
