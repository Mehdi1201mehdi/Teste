"""Interface en ligne de commande (scripts, serveurs sans écran, tests de bout en bout)."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from mobilelab import __version__
from mobilelab.context import build_context
from mobilelab.core.errors import MobileLabError
from mobilelab.services import analysis, report
from mobilelab.services.backup import DEFAULT_ANDROID_FOLDERS
from mobilelab.services.compare import compare_backups
from mobilelab.services.diagnostics import run_checks
from mobilelab.services.integrity import verify_backup


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
        scan = ctx.devices.scan()
        device = next((d for d in scan.devices if d.serial == args.serial), None)
        if device is None:
            raise MobileLabError(f"Appareil introuvable : {args.serial}")
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
    if args.cmd == "compare":
        d = compare_backups(args.old, args.new)
        print(f"+{len(d.added)} ajoutés, -{len(d.removed)} supprimés, "
              f"~{len(d.modified)} modifiés, ={d.unchanged} identiques")
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
