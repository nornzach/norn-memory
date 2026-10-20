"""Tests for exact records: exact_store.py, the /exact routes and the exact_* MCP tools.

The unit tests at the top run anywhere. The store, REST and MCP tests need Postgres (JSONB and
pg_trgm): point NORN_M_TEST_POSTGRES_URL at a database they may wipe, for example
postgresql+psycopg://postgres:<password>@postgres:5432/norn_m_exact_test. Without it they are skipped.
As in test_server_features.py, ``server/`` is put on ``sys.path``.
"""

import importlib
import os
import secrets
import sys
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

pytest.importorskip("fastapi", reason="fastapi not installed")
pytest.importorskip("httpx", reason="httpx not installed")

from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

SERVER_DIR = Path(__file__).resolve().parent.parent / "server"
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

TEST_ENV = {
    "JWT_SECRET": "test-secret-for-pytest-only-0123456789",
    "OPENAI_API_KEY": "fake-key",
    "ADMIN_API_KEY": "",
    "AUTH_DISABLED": "false",
    "NORN_M_TELEMETRY": "false",
    "NORN_M_ALLOW_SECRETS": "",
}
ADMIN_KEY = "test-admin-key-for-pytest-0123456789"
USER = {"X-Norn-M-User-Id": "zach"}
MCP_HEADERS = {"Accept": "application/json, text/event-stream", "X-API-Key": ADMIN_KEY, **USER}
# Characters that a rewrite, a LIKE pattern or JSON escaping could mangle.
TRICKY_PASSWORD = "  p@ss w0rd!%_\\'\"中文 "


@pytest.fixture(scope="module", autouse=True)
def _server_env():
    with patch.dict(os.environ, TEST_ENV):
        yield


def _scope(**kwargs):
    from scopes import KeyScope

    return KeyScope.build(**kwargs)


# Built at runtime so no credential-shaped literal sits in the repo.
def _openai_key():
    return "sk-proj-" + secrets.token_urlsafe(32)


# ---------------------------------------------------------------------------
# Unit tests (no database)
# ---------------------------------------------------------------------------


class TestNormalizeKey:
    @pytest.mark.parametrize(
        "raw, expected",
        [
            ("server/hk1", "server/hk1"),
            ("  Server / HK1/ ", "server/hk1"),
            ("site//GitHub.com", "site/github.com"),
            ("person/My   Mom", "person/my mom"),
            ("person/妈妈", "person/妈妈"),
            ("note/two\nlines", "note/two lines"),
        ],
    )
    def test_equivalent_spellings_are_one_key(self, raw, expected):
        from exact_store import normalize_key

        assert normalize_key(raw) == expected

    @pytest.mark.parametrize("raw", ["", "   ", "///", "a\x00b", "a\x7fb", "x" * 256, None])
    def test_invalid_keys_are_rejected(self, raw):
        from exact_store import normalize_key

        with pytest.raises(ValueError):
            normalize_key(raw)


class TestQueryTerms:
    @pytest.mark.parametrize(
        "query, expected",
        [
            ("what's my github password?", ["github", "password"]),
            ("hk1 ip 203.0.113.7", ["hk1", "ip", "203.0.113.7"]),
            ("zach@example.com", ["zach@example.com"]),
            ("server/hk1.", ["server/hk1"]),
            ("github密码", ["github", "密码"]),
            ("妈妈的生日", ["妈妈", "妈的", "的生", "生日"]),
            # Only filler words: search for them anyway rather than for nothing.
            ("my", ["my"]),
        ],
    )
    def test_terms(self, query, expected):
        from exact_store import query_terms

        assert query_terms(query) == expected

    def test_terms_are_capped(self):
        from exact_store import MAX_QUERY_TERMS, query_terms

        assert len(query_terms(" ".join(f"term{i}" for i in range(40)))) == MAX_QUERY_TERMS


class TestSearchText:
    def test_includes_every_part_and_nested_values(self):
        from exact_store import build_search_text

        text = build_search_text(
            "server/hk1",
            "server",
            "HK1 Docker host",
            "Runs the media stack",
            ["prod", "docker"],
            {"ip": "203.0.113.7", "ports": [22, 443], "ssh": {"user": "root"}, "backup": True},
        )

        for part in ("server/hk1", "HK1 Docker host", "prod docker", "ip: 203.0.113.7", "22 443", "user root"):
            assert part in text
        assert "backup: true" in text and "Runs the media stack" in text


class TestRecordWrite:
    def test_kind_and_tags_are_normalized(self):
        from exact_store import RecordWrite

        data = RecordWrite(kind=" Server ", tags=["prod", "  prod ", "home  lab", ""])
        assert data.kind == "server"
        assert data.tags == ["prod", "home lab"]

    @pytest.mark.parametrize(
        "values",
        [
            {"kind": "not a kind!"},
            {"fields": {"": "x"}},
            {"fields": {f"f{i}": i for i in range(201)}},
            {"tags": ["x" * 65]},
        ],
    )
    def test_invalid_values_are_rejected(self, values):
        from exact_store import RecordWrite

        with pytest.raises(ValidationError):
            RecordWrite(**values)


class TestResolveUser:
    def test_unscoped_caller_must_name_a_user(self):
        from exact_store import resolve_user

        assert resolve_user(None, " zach ", write=True) == "zach"
        with pytest.raises(HTTPException) as exc:
            resolve_user(None, None, write=False)
        assert exc.value.status_code == 400

    def test_key_limited_to_one_user_defaults_to_it(self):
        from exact_store import resolve_user

        assert resolve_user(_scope(user_ids=["zach"]), None, write=True) == "zach"

    @pytest.mark.parametrize(
        "scope, user_id, write",
        [
            (dict(user_ids=["zach"]), "someone-else", False),
            (dict(access="read"), "zach", True),
            (dict(agent_ids=["claude"]), "zach", False),
            (dict(categories=["Ops"]), "zach", False),
        ],
    )
    def test_scope_limits_apply(self, scope, user_id, write):
        from exact_store import resolve_user

        with pytest.raises(HTTPException) as exc:
            resolve_user(_scope(**scope), user_id, write=write)
        assert exc.value.status_code == 403

    def test_read_only_key_can_read(self):
        from exact_store import resolve_user

        assert resolve_user(_scope(access="read"), "zach", write=False) == "zach"


class TestScore:
    def test_well_matched_needs_two_thirds_of_the_terms(self):
        from exact_store import well_matched

        def result(hits, terms, exact=False):
            return {"match": {"exact_key": exact, "terms": ["t"] * terms, "matched_terms": hits}}

        assert well_matched(result(1, 1)) and well_matched(result(2, 3)) and well_matched(result(3, 4))
        assert well_matched(result(0, 3, exact=True))
        assert not well_matched(result(1, 2)) and not well_matched(result(2, 4)) and not well_matched({})


class TestAnalyticsPaths:
    @pytest.mark.parametrize(
        "path, expected",
        [
            ("/exact/records/server/hk1", "/exact/records/{key}"),
            ("/exact/history/site/github.com", "/exact/history/{key}"),
            ("/exact/records", "/exact/records"),
        ],
    )
    def test_record_keys_are_collapsed(self, path, expected):
        from routers.analytics import normalize_path

        assert normalize_path(path) == expected


class TestSecretGuardMessage:
    def test_points_to_exact_records_without_echoing_the_value(self):
        import secret_guard

        key = _openai_key()
        with pytest.raises(HTTPException) as exc:
            secret_guard.check({"messages[0].content": f"The DeepSeek key is {key}"})
        detail = exc.value.detail
        assert "exact_set" in detail and "/exact/records/" in detail
        assert key not in detail


# ---------------------------------------------------------------------------
# Postgres-backed tests
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def pg_engine():
    url = os.environ.get("NORN_M_TEST_POSTGRES_URL")
    if not url:
        pytest.skip("NORN_M_TEST_POSTGRES_URL is not set")
    from sqlalchemy import create_engine, text
    from sqlalchemy.exc import OperationalError

    from db import Base
    from models import ExactRecord, ExactRecordVersion

    engine = create_engine(url)
    try:
        with engine.begin() as conn:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
    except OperationalError as exc:
        pytest.skip(f"Test database unreachable: {exc.__class__.__name__}")
    tables = [ExactRecord.__table__, ExactRecordVersion.__table__]
    Base.metadata.drop_all(engine, tables=tables)
    Base.metadata.create_all(engine, tables=tables)
    yield engine
    Base.metadata.drop_all(engine, tables=tables)
    engine.dispose()


@pytest.fixture
def store(pg_engine):
    from sqlalchemy import text
    from sqlalchemy.orm import sessionmaker

    import exact_store

    with pg_engine.begin() as conn:
        conn.execute(text("TRUNCATE exact_records, exact_record_versions"))
    factory = sessionmaker(bind=pg_engine, autoflush=False, expire_on_commit=False)
    with patch.object(exact_store, "SessionLocal", factory):
        yield exact_store


def _put(store, key, merge=False, user="zach", **values):
    return store.put_record(user, key, store.RecordWrite(**values), merge=merge)


def _seed(store):
    _put(
        store,
        "server/hk1",
        kind="server",
        title="HK1 Docker host",
        tags=["prod", "docker"],
        fields={"ip": "203.0.113.7", "user": "root", "password": TRICKY_PASSWORD, "compose_dir": "/opt/stack"},
    )
    _put(store, "server/hk2", kind="server", title="HK2 backup box", tags=["backup"], fields={"ip": "203.0.113.8"})
    _put(
        store,
        "site/github.com",
        kind="credential",
        title="GitHub",
        fields={"url": "https://github.com/login", "username": "zach", "password": "gh-pass-1"},
    )
    _put(
        store,
        "person/mom",
        kind="person",
        title="妈妈",
        description="妈妈的生日是 3 月 8 日",
        fields={"birthday": "1960-03-08"},
    )
    _put(store, "api/deepseek", kind="api_key", title="DeepSeek API", fields={"base_url": "https://api.deepseek.com"})


class TestStoreWrites:
    def test_values_come_back_verbatim(self, store):
        created = _put(store, "site/example.com", kind="credential", fields={"password": TRICKY_PASSWORD, "pin": 42})

        assert created["result"] == "created" and created["version"] == 1
        record = store.get_record("zach", " Site / Example.com ")
        assert record["fields"] == {"password": TRICKY_PASSWORD, "pin": 42}
        assert record["key"] == "site/example.com"

    def test_records_are_per_user(self, store):
        _put(store, "server/hk1", fields={"ip": "1"})
        _put(store, "server/hk1", user="someone-else", fields={"ip": "2"})

        assert store.get_record("zach", "server/hk1")["fields"] == {"ip": "1"}
        assert store.search_records("zach", "hk1")[0]["fields"] == {"ip": "1"}

    def test_merge_changes_only_the_given_fields_and_keeps_history(self, store):
        _put(
            store, "server/hk1", kind="server", title="HK1", tags=["prod"], fields={"ip": "203.0.113.7", "user": "root"}
        )

        updated = _put(store, "server/hk1", merge=True, fields={"ip": "203.0.113.9", "user": None, "port": 2222})

        assert updated["result"] == "updated" and updated["version"] == 2
        assert updated["fields"] == {"ip": "203.0.113.9", "port": 2222}
        assert updated["title"] == "HK1" and updated["tags"] == ["prod"] and updated["kind"] == "server"
        history = store.history("zach", "server/hk1")
        assert [v["version"] for v in history["versions"]] == [1]
        assert history["versions"][0]["fields"] == {"ip": "203.0.113.7", "user": "root"}
        assert history["versions"][0]["change"] == "update"

    def test_replace_drops_what_is_not_given(self, store):
        _put(store, "server/hk1", kind="server", title="HK1", fields={"ip": "1", "user": "root"})

        replaced = _put(store, "server/hk1", fields={"ip": "2"})

        assert replaced["fields"] == {"ip": "2"} and replaced["title"] == "" and replaced["kind"] == "note"

    def test_identical_write_is_unchanged_and_not_versioned(self, store):
        _put(store, "server/hk1", fields={"ip": "1"})

        again = _put(store, "server/hk1", fields={"ip": "1"})

        assert again["result"] == "unchanged" and again["version"] == 1
        assert store.history("zach", "server/hk1")["versions"] == []

    def test_if_version_guards_against_lost_updates(self, store):
        data = store.RecordWrite(fields={"ip": "1"})
        store.put_record("zach", "server/hk1", data, merge=True, if_version=0)
        with pytest.raises(HTTPException) as exc:
            store.put_record("zach", "server/hk1", store.RecordWrite(fields={"ip": "2"}), merge=True, if_version=0)
        assert exc.value.status_code == 409
        assert (
            store.put_record("zach", "server/hk1", store.RecordWrite(fields={"ip": "2"}), merge=True, if_version=1)[
                "version"
            ]
            == 2
        )

    def test_oversized_record_is_refused(self, store):
        with pytest.raises(HTTPException) as exc:
            _put(store, "note/huge", fields={"blob": "x" * (store.MAX_RECORD_BYTES + 1)})
        assert exc.value.status_code == 413
        assert store.get_record("zach", "note/huge") is None

    def test_delete_keeps_the_last_state(self, store):
        _put(store, "site/github.com", fields={"password": "gh-pass-1"})

        assert store.delete_record("zach", "site/github.com") is True
        assert store.get_record("zach", "site/github.com") is None
        assert store.delete_record("zach", "site/github.com") is False
        versions = store.history("zach", "site/github.com")["versions"]
        assert versions[0]["change"] == "delete" and versions[0]["fields"] == {"password": "gh-pass-1"}

    def test_batch_is_all_or_nothing(self, store):
        items = [store.BatchItem(key=f"site/s{i}.com", fields={"password": f"p{i}"}) for i in range(3)]
        assert store.put_many("zach", items, merge=False) == {"created": 3, "updated": 0, "unchanged": 0}

        bad = [
            store.BatchItem(key="site/s0.com", fields={"password": "changed"}),
            store.BatchItem(key="note/huge", fields={"blob": "x" * (store.MAX_RECORD_BYTES + 1)}),
        ]
        with pytest.raises(HTTPException):
            store.put_many("zach", bad, merge=False)
        assert store.get_record("zach", "site/s0.com")["fields"] == {"password": "p0"}

        with pytest.raises(HTTPException) as exc:
            store.put_many("zach", [store.BatchItem(key="a"), store.BatchItem(key=" A ")], merge=False)
        assert exc.value.status_code == 400


class TestStoreSearch:
    def _keys(self, results):
        return [r["key"] for r in results]

    def test_exact_key_ranks_first(self, store):
        _seed(store)
        results = store.search_records("zach", "server/hk1")
        assert results[0]["key"] == "server/hk1" and results[0]["match"]["exact_key"] is True

    @pytest.mark.parametrize(
        "query, first",
        [
            ("github password", "site/github.com"),
            ("what's my GitHub password?", "site/github.com"),
            ("203.0.113.7", "server/hk1"),
            ("hk1 ip", "server/hk1"),
            ("妈妈 生日", "person/mom"),
            ("妈妈的生日", "person/mom"),
            ("deepseek base_url", "api/deepseek"),
            ("/opt/stack", "server/hk1"),
        ],
    )
    def test_keyword_queries(self, store, query, first):
        _seed(store)
        assert self._keys(store.search_records("zach", query))[0] == first

    def test_like_wildcards_in_the_query_are_literal(self, store):
        _seed(store)
        # Only hk1's password contains a literal "%" or "w0rd!%_".
        assert self._keys(store.search_records("zach", "w0rd!%_")) == ["server/hk1"]
        assert self._keys(store.search_records("zach", "%")) == ["server/hk1"]

    def test_typos_are_tolerated(self, store):
        _seed(store)
        assert self._keys(store.search_records("zach", "githb"))[:1] == ["site/github.com"]

    def test_unrelated_query_finds_nothing(self, store):
        _seed(store)
        assert store.search_records("zach", "kubernetes cluster") == []

    def test_filters_and_listing(self, store):
        _seed(store)
        assert self._keys(store.search_records("zach", prefix="server/")) == ["server/hk1", "server/hk2"]
        assert self._keys(store.search_records("zach", kind="credential")) == ["site/github.com"]
        assert self._keys(store.search_records("zach", tag="docker")) == ["server/hk1"]
        # Equal matches: the most recently updated first.
        assert self._keys(store.search_records("zach", "203.0.113", prefix="server/")) == ["server/hk2", "server/hk1"]
        assert len(store.search_records("zach", limit=2)) == 2
        assert self._keys(store.search_records("zach", limit=2, offset=4)) == ["site/github.com"]

    def test_same_query_same_order(self, store):
        _seed(store)
        assert store.search_records("zach", "203.0.113") == store.search_records("zach", "203.0.113")

    def test_close_keys(self, store):
        _seed(store)
        assert set(store.close_keys("zach", "server/hk3")[:2]) == {"server/hk1", "server/hk2"}


# ---------------------------------------------------------------------------
# REST routes and MCP tools
# ---------------------------------------------------------------------------


@pytest.fixture
def app(store):
    pytest.importorskip("mcp", reason="mcp not installed")
    mock_memory = MagicMock()
    with patch("norn_m.Memory.from_config", return_value=mock_memory):
        import main

        main = importlib.reload(main)
    import auth

    with ExitStack() as stack:
        stack.enter_context(patch.object(auth, "ADMIN_API_KEY", ADMIN_KEY))
        stack.enter_context(patch.object(auth, "_get_default_user", return_value=None))
        stack.enter_context(patch.object(main.webhooks, "emit_memory_results"))
        stack.enter_context(patch.object(main.categorizer, "categorize_memories"))
        stack.enter_context(patch.object(main, "_persist_request_log"))
        stack.enter_context(patch.object(main, "get_memory_instance", return_value=mock_memory))
        with TestClient(main.app) as client:
            yield SimpleNamespace(client=client, memory=mock_memory, store=store)


def _rest(app, method, path, **kwargs):
    headers = {"X-API-Key": ADMIN_KEY, **USER, **kwargs.pop("headers", {})}
    return app.client.request(method, path, headers=headers, **kwargs)


def _tool(app, name, arguments, headers=None):
    body = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": arguments}}
    resp = app.client.post("/mcp", json=body, headers={**MCP_HEADERS, **(headers or {})})
    assert resp.status_code == 200, resp.text
    return resp.json()["result"]


class TestRestRoutes:
    def test_put_get_search_history_delete(self, app):
        body = {"kind": "credential", "fields": {"username": "zach", "password": TRICKY_PASSWORD}}
        created = _rest(app, "PUT", "/exact/records/site/github.com", json=body)
        assert created.status_code == 201 and created.json()["result"] == "created"

        updated = _rest(app, "PUT", "/exact/records/site/github.com", json={"merge": True, "fields": {"otp": "on"}})
        assert updated.status_code == 200 and updated.json()["version"] == 2

        record = _rest(app, "GET", "/exact/records/Site/GitHub.com").json()
        assert record["fields"] == {"username": "zach", "password": TRICKY_PASSWORD, "otp": "on"}

        results = _rest(app, "GET", "/exact/records", params={"q": "github password"}).json()["results"]
        assert [r["key"] for r in results] == ["site/github.com"]

        history = _rest(app, "GET", "/exact/history/site/github.com").json()
        assert [v["version"] for v in history["versions"]] == [1]

        assert _rest(app, "DELETE", "/exact/records/site/github.com").json()["deleted"] is True
        assert _rest(app, "GET", "/exact/records/site/github.com").status_code == 404

    def test_user_comes_from_query_or_header(self, app):
        _rest(app, "PUT", "/exact/records/server/hk1", json={"user_id": "other", "fields": {"ip": "1"}})
        assert _rest(app, "GET", "/exact/records/server/hk1").status_code == 404
        assert _rest(app, "GET", "/exact/records/server/hk1", params={"user_id": "other"}).status_code == 200
        missing = app.client.get("/exact/records", headers={"X-API-Key": ADMIN_KEY})
        assert missing.status_code == 400

    def test_batch_import(self, app):
        records = [{"key": f"site/s{i}.com", "kind": "credential", "fields": {"password": f"p{i}"}} for i in range(5)]
        resp = _rest(app, "POST", "/exact/batch", json={"records": records})
        assert resp.json() == {"created": 5, "updated": 0, "unchanged": 0}
        assert len(_rest(app, "GET", "/exact/records", params={"prefix": "site/"}).json()["results"]) == 5

    def test_export_round_trips_through_batch(self, app):
        _rest(app, "PUT", "/exact/records/server/hk1", json={"kind": "server", "fields": {"password": TRICKY_PASSWORD}})
        _rest(app, "PUT", "/exact/records/site/github.com", json={"user_id": "other", "tags": ["dev"]})

        resp = _rest(app, "GET", "/exact/export")
        assert resp.status_code == 200
        assert resp.headers["content-disposition"].startswith('attachment; filename="norn-m-exact-records-')
        body = resp.json()
        assert body["count"] == 2
        assert [(r["user_id"], r["key"]) for r in body["exact_records"]] == [
            ("other", "site/github.com"),
            ("zach", "server/hk1"),
        ]
        only_zach = _rest(app, "GET", "/exact/export", params={"user_id": "zach"}).json()["exact_records"]
        assert [r["key"] for r in only_zach] == ["server/hk1"]

        exported = body["exact_records"][1]
        assert _rest(app, "DELETE", "/exact/records/server/hk1").json()["deleted"] is True
        restored = _rest(app, "POST", "/exact/batch", json={"user_id": "zach", "records": [exported]})
        assert restored.json() == {"created": 1, "updated": 0, "unchanged": 0}
        assert _rest(app, "GET", "/exact/records/server/hk1").json()["fields"] == {"password": TRICKY_PASSWORD}

    def test_export_needs_an_admin(self, app):
        assert app.client.get("/exact/export").status_code == 401

    def test_conflict_and_validation_errors(self, app):
        _rest(app, "PUT", "/exact/records/server/hk1", json={"fields": {"ip": "1"}})
        stale = _rest(app, "PUT", "/exact/records/server/hk1", json={"if_version": 0, "fields": {"ip": "2"}})
        assert stale.status_code == 409
        assert _rest(app, "PUT", "/exact/records/server/hk1", json={"kind": "bad kind"}).status_code == 422
        assert _rest(app, "PUT", "/exact/records/%20/", json={}).status_code == 400

    def test_requires_auth(self, app):
        assert app.client.get("/exact/records", headers=USER).status_code == 401


class TestMcpTools:
    def test_set_then_get_is_verbatim(self, app):
        result = _tool(
            app,
            "exact_set",
            {"key": "server/hk1", "kind": "server", "fields": {"ip": "203.0.113.7", "password": TRICKY_PASSWORD}},
        )
        assert result["isError"] is False and result["structuredContent"]["result"] == "created"

        _tool(app, "exact_set", {"key": "server/hk1", "fields": {"port": 22}})
        record = _tool(app, "exact_get", {"key": "Server/HK1"})["structuredContent"]
        assert record["fields"] == {"ip": "203.0.113.7", "password": TRICKY_PASSWORD, "port": 22}
        assert record["version"] == 2

    def test_replace_overwrites(self, app):
        _tool(app, "exact_set", {"key": "server/hk1", "fields": {"ip": "1", "user": "root"}})
        _tool(app, "exact_set", {"key": "server/hk1", "fields": {"ip": "2"}, "replace": True})
        assert _tool(app, "exact_get", {"key": "server/hk1"})["structuredContent"]["fields"] == {"ip": "2"}

    def test_missing_key_suggests_close_ones(self, app):
        _seed(app.store)
        result = _tool(app, "exact_get", {"key": "server/hk3"})
        assert result["isError"] is True
        assert "server/hk1" in result["content"][0]["text"]

    def test_search_and_delete(self, app):
        _seed(app.store)
        found = _tool(app, "exact_search", {"query": "github password"})["structuredContent"]["results"]
        assert found[0]["key"] == "site/github.com" and found[0]["fields"]["password"] == "gh-pass-1"

        assert _tool(app, "exact_delete", {"key": "site/github.com"})["structuredContent"]["deleted"] is True
        assert _tool(app, "exact_delete", {"key": "site/github.com"})["isError"] is True

    def test_search_memories_includes_well_matched_records(self, app):
        _seed(app.store)
        app.memory.search.return_value = {"results": [{"id": "m1", "memory": "GitHub is the main code host"}]}

        result = _tool(app, "search_memories", {"query": "github password"})["structuredContent"]

        assert result["results"][0]["id"] == "m1"
        assert [r["key"] for r in result["exact_records"]] == ["site/github.com"]

    def test_search_memories_leaves_out_weak_matches(self, app):
        _seed(app.store)
        app.memory.search.return_value = {"results": []}

        result = _tool(app, "search_memories", {"query": "which docker image does the blog use"})["structuredContent"]

        assert "exact_records" not in result

    def test_add_memory_with_a_secret_points_to_exact_set(self, app):
        result = _tool(app, "add_memory", {"text": f"My DeepSeek key is {_openai_key()}"})
        assert result["isError"] is True and "exact_set" in result["content"][0]["text"]
        app.memory.add.assert_not_called()

    def test_key_limited_to_an_agent_cannot_use_records(self, app):
        import mcp_server

        async def agent_key(request, *_):
            request.state.key_scope = _scope(agent_ids=["claude"])

        with patch.object(mcp_server, "verify_auth", agent_key):
            result = _tool(app, "exact_get", {"key": "server/hk1"})
        assert result["isError"] is True and "user only" in result["content"][0]["text"]

    def test_read_only_key_cannot_write(self, app):
        import mcp_server

        async def read_key(request, *_):
            request.state.key_scope = _scope(access="read")

        with patch.object(mcp_server, "verify_auth", read_key):
            result = _tool(app, "exact_set", {"key": "server/hk1", "fields": {"ip": "1"}})
        assert result["isError"] is True and "read-only" in result["content"][0]["text"]


class TestProvenance:
    """Each record keeps where its latest change came from, and can be found by it."""

    SOURCE = {"device": "mac", "agent": "claude-code", "key_label": "laptop"}

    def test_create_records_the_source(self, store):
        data = store.RecordWrite(fields={"ip": "1"}, project="Norn-M", cwd="/repo/")
        record = store.put_record("zach", "server/hk1", data, merge=False, source=self.SOURCE)
        assert {f: record[f] for f in ("device", "agent", "project", "cwd", "key_label")} == {
            "device": "mac",
            "agent": "claude-code",
            "project": "norn-m",
            "cwd": "/repo",
            "key_label": "laptop",
        }

    def test_an_update_restamps_and_history_keeps_the_old_source(self, store):
        store.put_record("zach", "server/hk1", store.RecordWrite(fields={"ip": "1"}, project="a"), merge=False)
        phone = {"device": "phone", "key_label": "phone"}
        updated = store.put_record(
            "zach", "server/hk1", store.RecordWrite(fields={"ip": "2"}), merge=True, source=phone
        )

        # Fields the update did not supply keep their earlier value.
        assert (updated["device"], updated["key_label"], updated["project"]) == ("phone", "phone", "a")
        old = store.history("zach", "server/hk1")["versions"][0]
        assert (old["device"], old["project"]) == (None, "a")

    def test_an_unchanged_write_keeps_the_original_source(self, store):
        store.put_record("zach", "server/hk1", store.RecordWrite(fields={"ip": "1"}), merge=False, source=self.SOURCE)
        again = store.put_record(
            "zach", "server/hk1", store.RecordWrite(fields={"ip": "1"}), merge=True, source={"device": "phone"}
        )
        assert again["result"] == "unchanged" and again["device"] == "mac"

    def test_key_label_cannot_be_set_in_the_body(self, store):
        data = store.RecordWrite.model_validate({"fields": {"ip": "1"}, "key_label": "forged"})
        assert store.put_record("zach", "server/hk1", data, merge=False)["key_label"] is None

    def test_search_by_project_device_agent_and_folder(self, store):
        put = store.put_record
        put("zach", "a", store.RecordWrite(project="norn-m", cwd="/repo"), merge=False, source={"device": "mac"})
        put("zach", "b", store.RecordWrite(project="norn-m", cwd="/repo/server"), merge=False, source={"agent": "omp"})
        put("zach", "c", store.RecordWrite(project="web", cwd="/repo-old"), merge=False, source={"device": "mac"})
        put("zach", "d", store.RecordWrite(cwd="C:\\repo\\api"), merge=False)

        def keys(**filters):
            return [r["key"] for r in store.search_records("zach", **filters)]

        assert keys(project="NORN-M") == ["a", "b"]
        assert keys(device="mac") == ["a", "c"]
        assert keys(agent="omp") == ["b"]
        assert keys(cwd="/repo") == ["a", "b"]
        assert keys(cwd="C:\\repo") == ["d"]
        assert keys(project="norn-m", device="mac") == ["a"]

    def test_exact_set_records_the_connection(self, app):
        headers = {"X-Norn-M-Device": "Windows", "X-Norn-M-Agent": "Devin"}
        arguments = {"key": "server/hk1", "fields": {"ip": "1"}, "project": "infra", "cwd": "/srv/infra"}
        record = _tool(app, "exact_set", arguments, headers)
        content = record["structuredContent"]
        assert (content["device"], content["agent"], content["project"], content["key_label"]) == (
            "windows",
            "devin",
            "infra",
            "admin",
        )
        found = _tool(app, "exact_search", {"project": "infra", "device": "windows"})["structuredContent"]
        assert [r["key"] for r in found["results"]] == ["server/hk1"]
        assert _tool(app, "exact_search", {"cwd": "/srv"})["structuredContent"]["results"][0]["key"] == "server/hk1"
        assert _tool(app, "exact_search", {"cwd": "/srv/other"})["structuredContent"]["results"] == []

    def test_rest_put_uses_headers_and_body(self, app):
        resp = _rest(
            app,
            "PUT",
            "/exact/records/site/github.com",
            headers={"X-Norn-M-Device": "web", "X-Norn-M-Project": "ignored"},
            json={"fields": {"username": "zach"}, "project": "personal"},
        )
        assert (resp.json()["device"], resp.json()["project"]) == ("web", "personal")
        listed = _rest(app, "GET", "/exact/records", params={"project": "personal"}).json()["results"]
        assert [r["key"] for r in listed] == ["site/github.com"]
