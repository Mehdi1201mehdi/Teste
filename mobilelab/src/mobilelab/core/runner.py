"""Exécution contrôlée des outils externes.

Règles :
- jamais de shell côté hôte (liste d'arguments, `shell=False`) ;
- seuls les outils de la liste blanche peuvent être lancés ;
- arguments typés `str`, sans caractère NUL ;
- délai maximal systématique ;
- commandes journalisées après masquage des secrets ;
- sous Windows, aucune fenêtre console ne s'ouvre (CREATE_NO_WINDOW).

Recherche d'un outil, dans l'ordre : chemin choisi par l'utilisateur, dossier `tools/` de
l'application (outils installés par MobileLab), puis le PATH du système.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import threading
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path

from mobilelab.core.errors import CommandError, ToolNotFoundError, UnsafePathError
from mobilelab.core.logging_setup import get_logger, redact

log = get_logger("runner")

ALLOWED_TOOLS = frozenset(
    {"adb", "idevice_id", "ideviceinfo", "idevicebackup2", "idevicepair", "aleapp", "ileapp"}
)

TOOL_HINTS = {
    "adb": "Onglet Diagnostic → « Installer ADB » (téléchargement officiel Google), ou "
    "installez Android Platform-Tools vous-même.",
    "idevice_id": "Onglet Diagnostic → « Installer les outils Apple », ou installez "
    "libimobiledevice (Linux : libimobiledevice-utils, macOS : brew install libimobiledevice).",
    "ideviceinfo": "Installez libimobiledevice.",
    "idevicebackup2": "Installez libimobiledevice.",
    "idevicepair": "Installez libimobiledevice.",
    "aleapp": "Installez ALEAPP (github.com/abrignoni/ALEAPP) puis indiquez son exécutable "
    "dans l'onglet Diagnostic.",
    "ileapp": "Installez iLEAPP (github.com/abrignoni/iLEAPP) puis indiquez son exécutable "
    "dans l'onglet Diagnostic.",
}

IS_WINDOWS = sys.platform == "win32"
# Évite le clignotement d'une console noire à chaque commande sous Windows.
_CREATIONFLAGS = getattr(subprocess, "CREATE_NO_WINDOW", 0) if IS_WINDOWS else 0


@dataclass(frozen=True)
class CommandResult:
    returncode: int
    stdout: str
    stderr: str
    duration: float

    @property
    def ok(self) -> bool:
        return self.returncode == 0


class CommandRunner:
    """Résout et lance les outils autorisés. Remplaçable par un double en test."""

    def __init__(self, overrides: dict[str, str] | None = None,
                 tool_dirs: Sequence[Path] = ()) -> None:
        self._overrides = dict(overrides or {})
        self.tool_dirs = list(tool_dirs)

    def set_override(self, tool: str, path: str | None) -> None:
        self._check_tool(tool)
        if path:
            self._overrides[tool] = path
        else:
            self._overrides.pop(tool, None)

    def override(self, tool: str) -> str | None:
        return self._overrides.get(tool)

    def resolve(self, tool: str) -> str | None:
        self._check_tool(tool)
        custom = self._overrides.get(tool)
        if custom:
            found = shutil.which(custom)
            if found:
                return found
            log.warning("Chemin configuré introuvable pour %s : %s", tool, custom)
        local = self._find_in_tool_dirs(tool)
        return str(local) if local else shutil.which(tool)

    def available(self, tool: str) -> bool:
        return self.resolve(tool) is not None

    def run(self, tool: str, args: Sequence[str], timeout: float = 30.0) -> CommandResult:
        res = self._run(tool, args, timeout, binary=False)
        return CommandResult(res.returncode, res.stdout, res.stderr, res.duration)

    def run_bytes(self, tool: str, args: Sequence[str], timeout: float = 30.0) -> bytes:
        """Comme `run`, mais renvoie la sortie standard brute (ex. capture d'écran PNG)."""
        res = self._run(tool, args, timeout, binary=True)
        if res.returncode != 0:
            raise CommandError(f"{tool} a échoué.", res.stderr.strip() or None)
        return res.raw

    def stream(
        self,
        tool: str,
        args: Sequence[str],
        on_line: Callable[[str], None],
        cancel: threading.Event | None = None,
        timeout: float = 3600.0,
    ) -> int:
        """Lance un outil long et transmet chaque ligne de sortie. Retourne le code de sortie."""
        argv = self._build_argv(tool, args)
        log.info("exec (stream) %s", redact(" ".join(argv)))
        deadline = time.monotonic() + timeout
        try:
            proc = subprocess.Popen(
                argv,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL,
                text=True,
                encoding="utf-8",
                errors="replace",
                shell=False,
                creationflags=_CREATIONFLAGS,
            )
        except OSError as exc:
            raise CommandError(f"Impossible de lancer {tool} : {exc}") from exc

        def _watchdog() -> None:
            while proc.poll() is None:
                if (cancel and cancel.is_set()) or time.monotonic() > deadline:
                    proc.terminate()
                    return
                time.sleep(0.2)

        threading.Thread(target=_watchdog, daemon=True).start()
        assert proc.stdout is not None
        for line in proc.stdout:
            on_line(redact(line.rstrip("\n")))
        return proc.wait()

    # -- interne ---------------------------------------------------------------
    @dataclass(frozen=True)
    class _Raw:
        returncode: int
        stdout: str
        stderr: str
        raw: bytes
        duration: float

    def _run(self, tool: str, args: Sequence[str], timeout: float, binary: bool) -> _Raw:
        argv = self._build_argv(tool, args)
        log.debug("exec %s", redact(" ".join(argv)))
        start = time.monotonic()
        try:
            proc = subprocess.run(
                argv,
                capture_output=True,
                timeout=timeout,
                shell=False,
                stdin=subprocess.DEVNULL,
                creationflags=_CREATIONFLAGS,
            )
        except subprocess.TimeoutExpired as exc:
            raise CommandError(
                f"{tool} n'a pas répondu en {timeout:.0f} s.",
                "Vérifiez la connexion de l'appareil puis réessayez.",
            ) from exc
        except OSError as exc:
            raise CommandError(f"Impossible de lancer {tool} : {exc}") from exc
        out = b"" if binary else proc.stdout
        return self._Raw(
            proc.returncode,
            out.decode("utf-8", "replace"),
            proc.stderr.decode("utf-8", "replace"),
            proc.stdout if binary else b"",
            time.monotonic() - start,
        )

    def _find_in_tool_dirs(self, tool: str) -> Path | None:
        names = [f"{tool}.exe", tool] if IS_WINDOWS else [tool]
        for base in self.tool_dirs:
            if not base.is_dir():
                continue
            for name in names:
                direct = base / name
                if direct.is_file():
                    return direct
            for name in names:  # un niveau de sous-dossiers (ex. tools/platform-tools/adb.exe)
                for candidate in sorted(base.glob(f"*/{name}")):
                    if candidate.is_file() and (IS_WINDOWS or os.access(candidate, os.X_OK)):
                        return candidate
        return None

    def _check_tool(self, tool: str) -> None:
        if tool not in ALLOWED_TOOLS:
            raise UnsafePathError(f"Outil non autorisé : {tool}")

    def _build_argv(self, tool: str, args: Sequence[str]) -> list[str]:
        exe = self.resolve(tool)
        if exe is None:
            raise ToolNotFoundError(f"Outil introuvable : {tool}", TOOL_HINTS.get(tool))
        for a in args:
            if not isinstance(a, str) or "\x00" in a:
                raise UnsafePathError("Argument de commande invalide.")
        return [exe, *args]
