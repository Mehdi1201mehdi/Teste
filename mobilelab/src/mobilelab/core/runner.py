"""Exécution contrôlée des outils externes.

Règles :
- jamais de shell côté hôte (liste d'arguments, `shell=False`) ;
- seuls les outils de la liste blanche peuvent être lancés ;
- arguments typés `str`, sans caractère NUL ;
- délai maximal systématique ;
- commandes journalisées après masquage des secrets.
"""

from __future__ import annotations

import shutil
import subprocess
import threading
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from mobilelab.core.errors import CommandError, ToolNotFoundError, UnsafePathError
from mobilelab.core.logging_setup import get_logger, redact

log = get_logger("runner")

ALLOWED_TOOLS = frozenset(
    {"adb", "idevice_id", "ideviceinfo", "idevicebackup2", "idevicepair", "aleapp", "ileapp"}
)

TOOL_HINTS = {
    "adb": "Installez Android Platform-Tools (developer.android.com/tools/releases/platform-tools) "
    "ou le paquet « adb » de votre distribution.",
    "idevice_id": "Installez libimobiledevice (paquet « libimobiledevice-utils » sous Linux, "
    "« brew install libimobiledevice » sous macOS).",
    "ideviceinfo": "Installez libimobiledevice.",
    "idevicebackup2": "Installez libimobiledevice.",
    "idevicepair": "Installez libimobiledevice.",
    "aleapp": "Installez ALEAPP (github.com/abrignoni/ALEAPP) puis indiquez son chemin.",
    "ileapp": "Installez iLEAPP (github.com/abrignoni/iLEAPP) puis indiquez son chemin.",
}


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

    def __init__(self, overrides: dict[str, str] | None = None) -> None:
        self._overrides = dict(overrides or {})

    def set_override(self, tool: str, path: str | None) -> None:
        self._check_tool(tool)
        if path:
            self._overrides[tool] = path
        else:
            self._overrides.pop(tool, None)

    def resolve(self, tool: str) -> str | None:
        self._check_tool(tool)
        candidate = self._overrides.get(tool, tool)
        return shutil.which(candidate)

    def available(self, tool: str) -> bool:
        return self.resolve(tool) is not None

    def run(self, tool: str, args: Sequence[str], timeout: float = 30.0) -> CommandResult:
        argv = self._build_argv(tool, args)
        log.debug("exec %s", redact(" ".join(argv)))
        start = time.monotonic()
        try:
            proc = subprocess.run(
                argv,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout,
                shell=False,
                stdin=subprocess.DEVNULL,
            )
        except subprocess.TimeoutExpired as exc:
            raise CommandError(
                f"{tool} n'a pas répondu en {timeout:.0f} s.",
                "Vérifiez la connexion de l'appareil puis réessayez.",
            ) from exc
        except OSError as exc:
            raise CommandError(f"Impossible de lancer {tool} : {exc}") from exc
        return CommandResult(proc.returncode, proc.stdout, proc.stderr, time.monotonic() - start)

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
