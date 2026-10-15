"""Rapports exportables (JSON, CSV, HTML) avec provenance de chaque donnée."""

from __future__ import annotations

import csv
import html
import json
from collections import Counter
from collections.abc import Iterable
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path

from mobilelab import __version__
from mobilelab.services.analysis import FileRecord, SourceSummary


def _header(summary: SourceSummary) -> dict:
    return {
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "generator": f"MobileLab {__version__}",
        "source": str(summary.path),
        "source_kind": summary.kind.value,
        "encrypted": summary.encrypted,
        "details": summary.details,
        "method": "Lecture seule ; types détectés par signature binaire.",
    }


def export_report(summary: SourceSummary, records: Iterable[FileRecord], path: Path) -> Path:
    records = list(records)
    suffix = path.suffix.lower()
    if suffix == ".json":
        path.write_text(json.dumps({**_header(summary), "files": [asdict(r) for r in records]},
                                   ensure_ascii=False, indent=2), encoding="utf-8")
    elif suffix == ".csv":
        with path.open("w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(["relative_path", "size", "mtime", "kind", "provenance"])
            for r in records:
                w.writerow([_csv_safe(r.relative_path), r.size, int(r.mtime), r.kind,
                            _csv_safe(r.provenance)])
    elif suffix in (".html", ".htm"):
        path.write_text(_html(summary, records), encoding="utf-8")
    else:
        raise ValueError("Format de rapport non pris en charge (json, csv, html).")
    return path


def _csv_safe(value: str) -> str:
    """Neutralise l'injection de formules dans les tableurs."""
    return "'" + value if value[:1] in ("=", "+", "-", "@") else value


def _html(summary: SourceSummary, records: list[FileRecord]) -> str:
    e = html.escape
    head = _header(summary)
    kinds = Counter(r.kind for r in records)
    total = sum(r.size for r in records)
    rows = "\n".join(
        f"<tr><td>{e(r.relative_path)}</td><td class=n>{r.size:,}</td><td>{e(r.kind)}</td>"
        f"<td class=p>{e(r.provenance)}</td></tr>" for r in records)
    details = "".join(f"<dt>{e(k)}</dt><dd>{e(str(v))}</dd>" for k, v in summary.details.items())
    chips = "".join(f"<span>{e(k)} · {v}</span>" for k, v in kinds.most_common())
    return f"""<!doctype html><html lang=fr><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>Rapport MobileLab</title>
<style>
:root{{--bg:#f7f8fa;--fg:#14161a;--mut:#5b6170;--line:#e3e6ec;--acc:#0f766e}}
@media(prefers-color-scheme:dark){{:root{{--bg:#111318;--fg:#e8eaf0;--mut:#9aa1b2;--line:#262a33;--acc:#2dd4bf}}}}
body{{margin:0;font:14px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--fg)}}
main{{max-width:1100px;margin:auto;padding:32px 16px}}h1{{margin:0 0 4px;font-size:22px}}
.mut{{color:var(--mut)}}dl{{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px}}
dt{{color:var(--mut)}}dd{{margin:0}}.chips span{{display:inline-block;border:1px solid var(--line);
border-radius:99px;padding:2px 10px;margin:2px}}
table{{width:100%;border-collapse:collapse;margin-top:16px}}
th,td{{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}}
td{{word-break:break-all}}.n{{text-align:right;white-space:nowrap}}.p{{color:var(--mut);font-size:12px}}
.badge{{color:var(--acc);font-weight:600}}
</style><main>
<h1>Rapport d'inventaire</h1>
<p class=mut>{e(head['generator'])} · généré le {e(head['generated_at'])} · {e(head['method'])}</p>
<dl><dt>Source</dt><dd>{e(head['source'])}</dd>
<dt>Type</dt><dd class=badge>{e(head['source_kind'])}</dd>
<dt>Fichiers</dt><dd>{len(records):,} ({total / 1e6:,.1f} Mo)</dd>{details}</dl>
<div class=chips>{chips}</div>
<table><thead><tr><th>Chemin</th><th class=n>Taille (octets)</th><th>Type</th><th>Provenance</th>
</tr></thead><tbody>{rows}</tbody></table></main></html>"""
