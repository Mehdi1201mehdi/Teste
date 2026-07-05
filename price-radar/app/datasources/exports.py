"""Export des résultats collectés : JSON, CSV, Excel (xlsx)."""
import csv
import io
import json


def _flatten(record: dict, prefix: str = "") -> dict:
    """Aplati un enregistrement imbriqué en colonnes simples."""
    flat = {}
    for k, v in record.items():
        key = f"{prefix}{k}"
        if isinstance(v, dict):
            flat.update(_flatten(v, f"{key}."))
        elif isinstance(v, list):
            flat[key] = json.dumps(v, ensure_ascii=False)[:500]
        else:
            flat[key] = v
    return flat


def to_json(records: list[dict]) -> bytes:
    return json.dumps(records, ensure_ascii=False, indent=2).encode("utf-8")


def to_csv(records: list[dict]) -> bytes:
    flats = [_flatten(r) for r in records]
    columns: list[str] = []
    for r in flats:
        for k in r:
            if k not in columns:
                columns.append(k)
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=columns, extrasaction="ignore")
    writer.writeheader()
    for r in flats:
        writer.writerow(r)
    return buf.getvalue().encode("utf-8-sig")  # BOM pour Excel/UTF-8


def to_xlsx(records: list[dict]) -> bytes:
    """Vrai fichier .xlsx via openpyxl (repli CSV si non installé)."""
    try:
        from openpyxl import Workbook
    except ImportError:
        return to_csv(records)
    flats = [_flatten(r) for r in records]
    columns: list[str] = []
    for r in flats:
        for k in r:
            if k not in columns:
                columns.append(k)
    wb = Workbook()
    ws = wb.active
    ws.title = "Résultats"
    ws.append(columns)
    for r in flats:
        ws.append([r.get(c, "") for c in columns])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


EXPORTS = {
    "json": (to_json, "application/json", "json"),
    "csv": (to_csv, "text/csv", "csv"),
    "xlsx": (to_xlsx,
             "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
             "xlsx"),
}
