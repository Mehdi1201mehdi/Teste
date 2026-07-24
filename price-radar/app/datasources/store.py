"""Persistance du dernier résultat de collecte par source (pour l'export et
l'auto-collecte). Bornée pour éviter des lignes énormes."""
import json

from .. import models

MAX_RECORDS = 200


def save_result(db, source_id: str, records: list[dict]):
    bounded = records[:MAX_RECORDS]
    payload = json.dumps(bounded, ensure_ascii=False)
    row = db.get(models.ApiCollectResult, source_id)
    if row is None:
        db.add(models.ApiCollectResult(source_id=source_id,
                                       count=len(records), payload=payload))
    else:
        row.count = len(records)
        row.payload = payload
        from datetime import datetime
        row.created_at = datetime.utcnow()
    db.commit()


def get_result(db, source_id: str) -> list[dict] | None:
    row = db.get(models.ApiCollectResult, source_id)
    if not row:
        return None
    try:
        return json.loads(row.payload)
    except (json.JSONDecodeError, TypeError):
        return None
