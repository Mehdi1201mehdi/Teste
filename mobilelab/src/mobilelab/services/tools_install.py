"""Installation des outils externes dans le dossier privé de l'application.

Seul usage réseau de MobileLab : **téléchargement** (jamais d'envoi) d'outils depuis leur
source officielle, uniquement après consentement explicite de l'utilisateur.

- ADB : archive officielle Google « platform-tools-latest-<os>.zip »
  (https://developer.android.com/tools/releases/platform-tools) ; en l'utilisant, vous
  acceptez les conditions de licence du SDK Android.
- Outils Apple (Windows) : dernière version publiée du projet open source
  libimobiledevice-win32/imobiledevice-net (LGPL). Nécessite aussi le pilote Apple
  (« Apple Mobile Device Support », installé avec iTunes ou l'app « Appareils Apple »).
"""

from __future__ import annotations

import json
import shutil
import ssl
import sys
import tempfile
import urllib.request
import zipfile
from collections.abc import Callable
from pathlib import Path

from mobilelab import __version__
from mobilelab.core.errors import MobileLabError, UnsafePathError
from mobilelab.core.logging_setup import get_logger

log = get_logger("tools")

Progress = Callable[[int, int, str], None]

PLATFORM_TOOLS_URL = "https://dl.google.com/android/repository/platform-tools-latest-{os}.zip"
IMOBILEDEVICE_API = "https://api.github.com/repos/libimobiledevice-win32/imobiledevice-net/releases/latest"
ALLOWED_HOSTS = ("dl.google.com", "api.github.com", "github.com",
                 "objects.githubusercontent.com", "release-assets.githubusercontent.com")
MAX_DOWNLOAD = 300 * 1024 * 1024


def _platform_key() -> str:
    if sys.platform == "win32":
        return "windows"
    if sys.platform == "darwin":
        return "darwin"
    return "linux"


def _check_url(url: str) -> None:
    from urllib.parse import urlparse

    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname not in ALLOWED_HOSTS:
        raise UnsafePathError(f"Source de téléchargement non autorisée : {parsed.hostname}")


def _opener() -> urllib.request.OpenerDirector:
    ctx = ssl.create_default_context()  # vérification TLS stricte (magasin système)
    return urllib.request.build_opener(urllib.request.HTTPSHandler(context=ctx))


def download(url: str, target: Path, progress: Progress | None = None) -> Path:
    _check_url(url)
    agent = {"User-Agent": f"MobileLab/{__version__}"}
    req = urllib.request.Request(url, headers=agent)  # noqa: S310 - URL validée ci-dessus
    log.info("Téléchargement : %s", url)
    with _opener().open(req, timeout=60) as resp:
        _check_url(resp.geturl())  # redirections : destination finale aussi contrôlée
        total = int(resp.headers.get("Content-Length") or 0)
        if total > MAX_DOWNLOAD:
            raise MobileLabError("Fichier à télécharger anormalement volumineux.")
        done = 0
        with target.open("wb") as fh:
            while chunk := resp.read(256 * 1024):
                done += len(chunk)
                if done > MAX_DOWNLOAD:
                    raise MobileLabError("Téléchargement interrompu : taille excessive.")
                fh.write(chunk)
                if progress:
                    progress(done, total, f"Téléchargement… {done // 1_048_576} Mo")
    return target


def safe_extract_zip(archive: Path, destination: Path) -> int:
    """Extrait un zip en refusant chemins absolus et remontées (« zip slip »)."""
    destination.mkdir(parents=True, exist_ok=True)
    root = destination.resolve()
    count = 0
    with zipfile.ZipFile(archive) as zf:
        for info in zf.infolist():
            target = (destination / info.filename).resolve()
            if target != root and root not in target.parents:
                raise UnsafePathError(f"Archive dangereuse : {info.filename}")
            if info.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(info) as src, target.open("wb") as dst:
                shutil.copyfileobj(src, dst)
            mode = (info.external_attr >> 16) & 0o777
            if mode and sys.platform != "win32":
                target.chmod(mode | 0o700)
            count += 1
    return count


def _replace_dir(staging: Path, final: Path) -> None:
    try:
        if final.exists():
            shutil.rmtree(final)
        shutil.move(str(staging), str(final))
    except PermissionError as exc:  # Windows : un adb.exe en cours d'exécution est verrouillé
        raise MobileLabError(
            "Impossible de remplacer les outils : un fichier est en cours d'utilisation.",
            "Fermez les logiciels qui utilisent ADB (Android Studio, autres outils) et "
            "réessayez.") from exc


def install_platform_tools(tools_dir: Path, *, consent: bool,
                           progress: Progress | None = None, url: str | None = None) -> Path:
    """Installe ADB dans `tools_dir/platform-tools`. Retourne le chemin de l'exécutable."""
    if not consent:
        raise MobileLabError("Téléchargement non autorisé par l'utilisateur.")
    url = url or PLATFORM_TOOLS_URL.format(os=_platform_key())
    tools_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=tools_dir) as tmp:
        archive = download(url, Path(tmp) / "platform-tools.zip", progress)
        if progress:
            progress(0, 0, "Extraction…")
        safe_extract_zip(archive, Path(tmp) / "x")
        extracted = Path(tmp) / "x" / "platform-tools"
        exe = extracted / ("adb.exe" if sys.platform == "win32" else "adb")
        if not exe.is_file():
            raise MobileLabError("Archive inattendue : adb absent.")
        _replace_dir(extracted, tools_dir / "platform-tools")
    final = tools_dir / "platform-tools" / exe.name
    log.info("ADB installé : %s", final)
    return final


def install_imobiledevice_windows(tools_dir: Path, *, consent: bool,
                                  progress: Progress | None = None,
                                  api_url: str = IMOBILEDEVICE_API) -> Path:
    """Installe les outils libimobiledevice pour Windows x64 dans `tools_dir/libimobiledevice`."""
    if not consent:
        raise MobileLabError("Téléchargement non autorisé par l'utilisateur.")
    tools_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=tools_dir) as tmp:
        meta = download(api_url, Path(tmp) / "release.json")
        release = json.loads(meta.read_text(encoding="utf-8"))
        assets = [a for a in release.get("assets", [])
                  if a.get("name", "").endswith(".zip") and "win-x64" in a.get("name", "")]
        if not assets:
            raise MobileLabError(
                "Aucune archive Windows x64 trouvée dans la dernière version.",
                "Téléchargez libimobiledevice pour Windows manuellement, puis indiquez "
                "idevice_id.exe dans l'onglet Diagnostic.")
        asset = assets[0]
        archive = download(asset["browser_download_url"], Path(tmp) / asset["name"], progress)
        staging = Path(tmp) / "libimobiledevice"
        safe_extract_zip(archive, staging)
        if not list(staging.rglob("idevice_id.exe")):
            raise MobileLabError("Archive inattendue : idevice_id.exe absent.")
        # Aplatit l'arborescence pour que les .exe et leurs DLL soient côte à côte.
        exe_dir = next(staging.rglob("idevice_id.exe")).parent
        _replace_dir(exe_dir, tools_dir / "libimobiledevice")
    log.info("Outils Apple installés (%s).", release.get("tag_name", "?"))
    return tools_dir / "libimobiledevice" / "idevice_id.exe"
