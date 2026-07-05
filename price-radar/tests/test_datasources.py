"""Tests du module 'Sources API gratuites' (hors ligne)."""
import app.datasources.base as base
from app.datasources import connector, get_source, list_sources, load_catalog
from app.datasources.exports import to_csv, to_json, to_xlsx


# ------------------------------------------------------------------- catalogue
def test_catalog_loads_all_categories():
    cat = load_catalog()
    assert len(cat["sources"]) >= 100          # ~110 sources
    ids = {s["id"] for s in cat["sources"]}
    for expected in ("open-meteo", "fakestore", "coingecko", "firecrawl",
                     "serpapi", "nominatim", "openfoodfacts", "restcountries"):
        assert expected in ids


def test_every_source_has_required_fields():
    for s in load_catalog()["sources"]:
        for field in ("id", "name", "category", "freeType", "baseUrl",
                      "authType", "kind"):
            assert field in s, f"{s.get('id')} manque {field}"
        assert s["freeType"] in ("free", "free-tier", "open-source", "open-data")
        assert s["authType"] in ("none", "api-key", "token", "oauth")


def test_list_sources_never_exposes_key_values(monkeypatch):
    monkeypatch.setenv("OPENWEATHER_API_KEY", "SECRET123")
    rows = list_sources(db=None, category="weather")
    owm = next(r for r in rows if r["id"] == "openweathermap")
    assert owm["configured"] is True
    # la valeur de la clé n'apparaît nulle part
    assert "SECRET123" not in str(rows)


# ------------------------------------------------------------------ connecteur
def test_test_connection_framework_is_info():
    res = connector.testConnection(get_source("playwright"))
    assert res["status"] == "info" and res["ok"] is True


def test_test_connection_unconfigured_key(monkeypatch):
    monkeypatch.delenv("SERPAPI_KEY", raising=False)
    res = connector.testConnection(get_source("serpapi"))
    assert res["status"] == "unconfigured"
    assert "SERPAPI_KEY" in res["message"]


def test_keyless_source_calls_endpoint(monkeypatch):
    class FakeResp:
        status_code = 200
        def json(self): return [{"id": 1, "title": "Produit"}]
    monkeypatch.setattr(base.requests, "get", lambda *a, **k: FakeResp())
    res = connector.fetchData(get_source("fakestore"))
    assert res["ok"] and res["count"] == 1
    assert res["records"][0]["title"] == "Produit"


def test_http_error_returns_clean_message_with_alternative(monkeypatch):
    class FakeResp:
        status_code = 429
        def json(self): return {}
    monkeypatch.setattr(base.requests, "get", lambda *a, **k: FakeResp())
    # openweathermap a une clé -> on la fournit pour atteindre la requête
    monkeypatch.setenv("OPENWEATHER_API_KEY", "k")
    res = connector.testConnection(get_source("openweathermap"))
    assert res["status"] == "error" and res["http"] == 429
    assert res.get("alternative") == "open-meteo"


def test_mask_hides_secret():
    assert base._mask("abcdef1234") == "abc…34"
    assert "1234" not in base._mask("abcdef1234")


def test_normalize_various_shapes():
    assert connector.normalizeData([{"a": 1}]) == [{"a": 1}]
    assert connector.normalizeData({"results": [{"x": 2}]}) == [{"x": 2}]
    assert connector.normalizeData({"a": 1}) == [{"a": 1}]


# --------------------------------------------------------------------- exports
def test_store_save_and_get(tmp_path, monkeypatch):
    # BDD SQLite isolée
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    import app.database as database
    from app import models
    eng = create_engine(f"sqlite:///{tmp_path}/t.db",
                        connect_args={"check_same_thread": False})
    models.Base.metadata.create_all(bind=eng)
    Session = sessionmaker(bind=eng)
    db = Session()
    from app.datasources.store import get_result, save_result
    save_result(db, "fakestore", [{"a": 1}, {"a": 2}])
    assert get_result(db, "fakestore") == [{"a": 1}, {"a": 2}]
    save_result(db, "fakestore", [{"a": 9}])       # upsert
    assert get_result(db, "fakestore") == [{"a": 9}]
    assert get_result(db, "inconnu") is None
    db.close()


def test_autocollect_skips_unconfigured(monkeypatch):
    """L'auto-collecte ne doit appeler QUE les sources prêtes."""
    import app.scheduler as sched
    import app.datasources.base as base
    import app.datasources.store as store
    from app import models
    from app.database import engine
    models.Base.metadata.create_all(bind=engine)   # tables présentes

    called = []
    monkeypatch.setattr(base.connector, "fetchData",
                        lambda src, path, db: called.append(src["id"]) or
                        {"ok": True, "status": "ok", "count": 1, "records": [{}]})
    monkeypatch.setattr(store, "save_result", lambda *a, **k: None)
    sched.run_datasource_autocollect()
    # sources à clé non configurées : jamais appelées
    assert "openweathermap" not in called
    assert "serpapi" not in called
    # une source sans clé avec test défini : appelée
    assert "fakestore" in called


def test_exports_produce_bytes():
    records = [{"name": "A", "price": 10, "nested": {"k": "v"}},
               {"name": "B", "price": 20, "tags": ["x", "y"]}]
    j = to_json(records)
    c = to_csv(records)
    x = to_xlsx(records)
    assert j.startswith(b"[") and b'"name"' in j
    assert b"name" in c and b"price" in c
    assert x[:2] == b"PK"          # xlsx = archive zip (signature PK)
