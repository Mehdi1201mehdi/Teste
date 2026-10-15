"""Interface en ligne de commande (scripts, serveurs sans écran, tests de bout en bout)."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from mobilelab import __version__
from mobilelab.context import build_context
from mobilelab.core.errors import MobileLabError
from mobilelab.services import analysis, report, tools_install
from mobilelab.services.backup import DEFAULT_ANDROID_FOLDERS
from mobilelab.services.compare import compare_backups
from mobilelab.services.diagnostics import run_checks
from mobilelab.services.integrity import verify_backup
from mobilelab.services.media import find_duplicates


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="mobilelab-cli", description="MobileLab en ligne de commande")
    p.add_argument("--version", action="version", version=__version__)
    p.add_argument("--simulation", action="store_true", help="appareils simulés (démo)")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("devices", help="lister les appareils")
    sub.add_parser("diagnose", help="diagnostic de l'environnement")
    b = sub.add_parser("backup", help="sauvegarder le stockage partagé Android")
    b.add_argument("serial")
    b.add_argument("destination", type=Path)
    b.add_argument("--path", action="append", help="dossier distant (répétable)")
    i = sub.add_parser("inventory", help="inventorier une sauvegarde ou un dossier")
    i.add_argument("source", type=Path)
    i.add_argument("--report", type=Path, help="fichier .json, .csv ou .html")
    v = sub.add_parser("verify", help="vérifier l'intégrité d'une sauvegarde MobileLab")
    v.add_argument("backup", type=Path)
    c = sub.add_parser("compare", help="comparer deux sauvegardes MobileLab")
    c.add_argument("old", type=Path)
    c.add_argument("new", type=Path)
    t = sub.add_parser("install-tools", help="télécharger les outils officiels (avec --yes)")
    t.add_argument("--apple", action="store_true", help="aussi les outils Apple (Windows)")
    t.add_argument("--yes", action="store_true", help="j'accepte le téléchargement")
    a = sub.add_parser("apps", help="lister les applications Android")
    a.add_argument("serial")
    a.add_argument("--system", action="store_true")
    s = sub.add_parser("screenshot", help="capture d'écran Android")
    s.add_argument("serial")
    s.add_argument("destination", type=Path)
    pu = sub.add_parser("push", help="envoyer des fichiers vers Android (sans écraser)")
    pu.add_argument("serial")
    pu.add_argument("files", type=Path, nargs="+")
    pu.add_argument("--to", default="/sdcard/Download/MobileLab")
    r = sub.add_parser("restore", help="renvoyer une sauvegarde MobileLab vers Android")
    r.add_argument("serial")
    r.add_argument("backup", type=Path)
    d = sub.add_parser("duplicates", help="doublons exacts dans un dossier")
    d.add_argument("folder", type=Path)
    args = p.parse_args(argv)

    ctx = build_context(simulation=args.simulation)
    try:
        return _dispatch(ctx, args)
    except MobileLabError as exc:
        print(f"Erreur : {exc}", file=sys.stderr)
        return 2
    finally:
        ctx.close()


def _dispatch(ctx, args) -> int:  # noqa: C901 - simple aiguillage
    if args.cmd == "devices":
        scan = ctx.devices.scan()
        for d in scan.devices:
            sim = " [SIMULATION]" if d.simulated else ""
            print(f"{d.platform.value:8} {d.serial:28} {d.state.label:22} "
                  f"{d.display_name} {d.os_version}{sim}")
        for problem in scan.problems:
            print(f"! {problem}", file=sys.stderr)
        if not scan.devices:
            print("Aucun appareil détecté.")
        return 0
    if args.cmd == "diagnose":
        for c in run_checks(ctx.runner, ctx.data_dir):
            print(f"[{c.level.value.upper():5}] {c.name}: {c.detail}" + (f"\n        → {c.hint}"
                                                                          if c.hint else ""))
        return 0
    if args.cmd == "backup":
        device = _find(ctx, args.serial)
        adapter = ctx.devices.adapter_for(device)
        roots = args.path or list(DEFAULT_ANDROID_FOLDERS.values())
        res = ctx.backups.backup_android(
            adapter, device, roots, args.destination,
            progress=lambda done, total, msg: print(f"[{done}/{total}] {msg}"))
        print(f"OK : {res.ok_count} fichier(s), {res.error_count} erreur(s) → {res.destination}")
        return 0 if not res.error_count else 1
    if args.cmd == "inventory":
        summary = analysis.identify(args.source)
        print(f"{summary.kind.value} — chiffrée : {'oui' if summary.encrypted else 'non'}")
        for k, val in summary.details.items():
            print(f"  {k}: {val}")
        if summary.kind is analysis.SourceKind.ANDROID_AB:
            records = analysis.ab_members(args.source)
        elif summary.kind is analysis.SourceKind.FILE:
            records = []
        else:
            records = list(analysis.inventory(args.source))
        print(f"{len(records)} fichier(s)")
        if args.report:
            report.export_report(summary, records, args.report)
            print(f"Rapport : {args.report}")
        return 0
    if args.cmd == "verify":
        r = verify_backup(args.backup)
        print(f"{r.ok}/{r.checked} fichier(s) intègres"
              + (" — MANIFESTE MODIFIÉ" if r.manifest_tampered else ""))
        for m in r.missing:
            print(f"  manquant : {m}")
        for m in r.mismatched:
            print(f"  altéré   : {m}")
        return 0 if r.valid else 1
    if args.cmd == "install-tools":
        if not args.yes:
            print("Ajoutez --yes pour accepter le téléchargement depuis les sources officielles "
                  "(ADB : dl.google.com, conditions du SDK Android).")
            return 1
        path = tools_install.install_platform_tools(ctx.tools_dir, consent=True)
        print(f"ADB installé : {path}")
        if args.apple:
            path = tools_install.install_imobiledevice_windows(ctx.tools_dir, consent=True)
            print(f"Outils Apple installés : {path}")
        return 0
    if args.cmd in ("apps", "screenshot", "push", "restore"):
        device = _find(ctx, args.serial)
        adapter = ctx.devices.adapter_for(device)
        if args.cmd == "apps":
            for app in adapter.list_packages(device.serial, args.system):
                print(f"{app.name:60} {app.version_code}")
            return 0
        if args.cmd == "screenshot":
            print(ctx.manager.screenshot(adapter, device, args.destination))
            return 0
        if args.cmd == "push":
            rep = ctx.manager.push_files(adapter, device, args.files, args.to)
        else:
            rep = ctx.manager.restore_backup(adapter, device, args.backup)
        for local, remote in rep.done:
            print(f"{local} → {remote}")
        for item, reason in rep.skipped:
            print(f"ignoré : {item} ({reason})", file=sys.stderr)
        print(rep.summary)
        return 0 if not rep.skipped else 1
    if args.cmd == "duplicates":
        files = [(r.relative_path, args.folder / r.relative_path)
                 for r in analysis.inventory(args.folder)]
        groups = find_duplicates(files)
        for g in groups:
            print(f"{len(g.paths)} × {g.size} o : " + " | ".join(g.paths))
        print(f"{len(groups)} groupe(s), {sum(g.wasted for g in groups)} octets récupérables")
        return 0
    if args.cmd == "compare":
        d = compare_backups(args.old, args.new)
        print(f"+{len(d.added)} ajoutés, -{len(d.removed)} supprimés, "
              f"~{len(d.modified)} modifiés, ={d.unchanged} identiques")
        return 0
    return 1


def _find(ctx, serial: str):
    device = next((d for d in ctx.devices.scan().devices if d.serial == serial), None)
    if device is None:
        raise MobileLabError(f"Appareil introuvable : {serial}",
                             "Liste des appareils : mobilelab-cli devices")
    return device


if __name__ == "__main__":
    raise SystemExit(main())
