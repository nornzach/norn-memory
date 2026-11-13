"""Paged memory listing (GET /memories?page_size=, GET /memories/sources) and the SQL behind it.

The SQL tests need a Postgres with pgvector and are skipped unless NORN_M_TEST_PG_DSN is set, e.g.
``NORN_M_TEST_PG_DSN=postgresql://postgres:pw@localhost:8432/postgres``. They create and drop their
own table. Each filter is checked against the Python scan it replaces, on the same rows, so the
two listings can't drift apart.
"""

import importlib
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

pytest.importorskip("fastapi", reason="fastapi not installed")

from fastapi.testclient import TestClient

SERVER_DIR = Path(__file__).resolve().parent.parent / "server"
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

import memory_store  # noqa: E402
from scopes import KeyScope  # noqa: E402

DSN = os.environ.get("NORN_M_TEST_PG_DSN")
TODAY = datetime.now(timezone.utc).date()


def _payload(i, **extra):
    created = datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(minutes=i)
    return {
        "data": f"Memory number {i}",
        "user_id": "zach" if i % 3 else "alex",
        "created_at": created.isoformat(),
        "updated_at": created.isoformat(),
        "categories": ["work"] if i % 2 else ["travel", "food"],
        **extra,
    }


def _rows():
    """45 memories with every field the filters look at, including the awkward cases."""
    payloads = [_payload(i) for i in range(40)]
    payloads[0]["device"] = "mac"
    payloads[1]["device"] = "windows"
    payloads[2].update(project="norn-m", agent="claude-code", cwd="/repo")
    payloads[3]["cwd"] = "/repo/server"
    payloads[4]["cwd"] = "/repository"  # shares a prefix, but isn't under /repo
    payloads[5]["cwd"] = "C:\\repo\\sub"
    payloads[6]["data"] = "Prefers PNPM over npm"
    payloads[7]["expiration_date"] = "2000-01-01"
    payloads[8]["expiration_date"] = (TODAY + timedelta(days=30)).isoformat()
    payloads[9]["expiration_date"] = TODAY.isoformat()  # expires after today, so still shown
    payloads[10]["expiration_date"] = "not a date"  # is_expired() treats it as never expiring
    payloads[11]["layer"] = "L0"
    payloads[12]["layer"] = "L1"
    payloads[13]["layer"] = "L9"  # unknown stored layer normalizes to L3 like stats do
    payloads[11]["agent_id"] = "bot"
    payloads[12]["categories"] = None
    payloads += [
        {"data": "No timestamp", "user_id": "zach"},
        _payload(41, run_id="run-1"),
        _payload(42, device="mac", project="norn-m"),
        _payload(43, cwd="C:\\repo"),
        _payload(44, data="100% sure_underscore"),
    ]
    return [SimpleNamespace(id=str(uuid.UUID(int=i + 1)), payload=p) for i, p in enumerate(payloads)]


# ---------------------------------------------------------------------------
# SQL against a real pgvector
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def pg_store():
    if not DSN:
        pytest.skip("set NORN_M_TEST_PG_DSN to run the SQL listing tests")
    from norn_m.vector_stores.pgvector import PGVector

    store = PGVector(
        dbname=None,
        collection_name=f"paging_test_{uuid.uuid4().hex[:8]}",
        embedding_model_dims=3,
        user=None,
        password=None,
        host=None,
        port=None,
        diskann=False,
        hnsw=False,
        minconn=1,
        maxconn=2,
        connection_string=DSN,
    )
    rows = _rows()
    store.insert(vectors=[[0.1, 0.2, 0.3]] * len(rows), payloads=[r.payload for r in rows], ids=[r.id for r in rows])
    yield store, rows
    store.delete_col()


@pytest.fixture
def pg(pg_store):
    store, rows = pg_store
    with patch.object(memory_store, "get_memory_instance", return_value=SimpleNamespace(vector_store=store)):
        yield rows


def _scanned(rows, **filters):
    """What the Python scan returns for these rows, the reference the SQL must match."""
    with patch.object(memory_store, "list_rows", return_value=rows):
        return memory_store._scan_memories(None, **filters)


def _ids(memories):
    return [m["id"] for m in memories]


FILTERS = [
    {},
    {"user_id": "zach"},
    {"agent_id": "bot"},
    {"run_id": "run-1"},
    {"category": "work"},
    {"category": "food"},
    {"source": {"device": "mac"}},
    {"source": {"project": "norn-m", "device": "mac"}},
    {"source": {"agent": "claude-code"}},
    {"source": {"cwd": "/repo"}},
    {"source": {"cwd": "C:\\repo"}},
    {"source": {"cwd": "/"}},
    {"layer": "L3"},
    {"layer": "L0"},
    {"layer": "L3", "user_id": "zach", "show_expired": False},
    {"text": "pnpm"},
    {"text": "100%"},
    {"text": "_under"},
    {"show_expired": False},
    {"user_id": "zach", "category": "work", "show_expired": False},
    {"scope": KeyScope.build(user_ids=["alex"])},
    {"scope": KeyScope.build(categories=["food"])},
    {"scope": KeyScope.build(user_ids=["zach", "alex"], categories=["work"])},
]


@pytest.mark.parametrize("filters", FILTERS, ids=lambda f: ",".join(f) or "none")
def test_sql_matches_the_python_scan(pg, filters):
    results, total = memory_store.query_memories(None, **filters)
    expected = _scanned(pg, **filters)
    assert set(_ids(results)) == set(_ids(expected))
    assert total == len(expected)


def test_pages_newest_first_with_the_total(pg):
    first, total = memory_store.query_memories(20, 0)
    second, _ = memory_store.query_memories(20, 20)
    last, _ = memory_store.query_memories(20, 40)

    assert total == len(pg) == 45
    assert [len(first), len(second), len(last)] == [20, 20, 5]
    everything = first + second + last
    assert len(set(_ids(everything))) == 45
    stamps = [m["created_at"] for m in everything if m["created_at"]]
    assert stamps == sorted(stamps, reverse=True)
    assert everything[-1]["memory"] == "No timestamp"


def test_offset_past_the_end_still_reports_the_total(pg):
    results, total = memory_store.query_memories(20, 1000, user_id="zach")
    assert results == []
    assert total == len(_scanned(pg, user_id="zach"))


def test_list_rows_and_list_memories_are_not_capped(pg):
    with patch.object(memory_store, "SCAN_LIMIT", 10):
        assert len(memory_store.list_rows()) == 45
        assert len(memory_store.list_memories(None)) == 45
        assert len(memory_store.list_memories(None, category="work")) == len(_scanned(pg, category="work"))


def test_source_values(pg):
    values = memory_store.list_source_values()
    assert values["device"] == ["mac", "windows"]
    assert values["project"] == ["norn-m"]
    assert values["agent"] == ["claude-code"]
    assert values["cwd"] == sorted(["/repo", "/repo/server", "/repository", "C:\\repo\\sub", "C:\\repo"])
    assert memory_store.list_source_values(user_id="alex")["device"] == ["mac"]
    assert memory_store.list_source_values(scope=KeyScope.build(user_ids=["alex"]))["device"] == ["mac"]


# ---------------------------------------------------------------------------
# Other vector stores: the capped scan, now paged and sorted the same way
# ---------------------------------------------------------------------------


def test_scan_fallback_pages_sorts_and_counts():
    rows = _rows()
    store = MagicMock()
    store.list.return_value = [rows]
    with patch.object(memory_store, "get_memory_instance", return_value=SimpleNamespace(vector_store=store)):
        page, total = memory_store.query_memories(5, 5, user_id="zach", show_expired=False)
        values = memory_store.list_source_values()

    expected = _scanned(rows, user_id="zach", show_expired=False)
    assert total == len(expected)
    assert _ids(page) == _ids(expected)[5:10]
    stamps = [m["created_at"] for m in expected if m["created_at"]]
    assert stamps == sorted(stamps, reverse=True)
    assert values["device"] == ["mac", "windows"]


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------


@pytest.fixture
def api():
    mock_memory = MagicMock()
    env = {
        "OPENAI_API_KEY": "fake-key",
        "ADMIN_API_KEY": "",
        "AUTH_DISABLED": "true",
        "JWT_SECRET": "test-secret-for-pytest",
    }
    with patch.dict(os.environ, env):
        with patch("norn_m.Memory.from_config", return_value=mock_memory):
            import server.main as server_main

            importlib.reload(server_main)
            yield TestClient(server_main.app), server_main, mock_memory


def test_page_size_returns_a_page_and_the_total(api):
    client, main, memory = api
    with patch.object(main, "query_memories", return_value=([{"id": "a"}], 4170)) as query:
        resp = client.get(
            "/memories",
            params={
                "page_size": 20,
                "offset": 40,
                "user_id": "zach",
                "category": "work",
                "project": "norn-m",
                "q": " pnpm ",
            },
        )

    assert resp.status_code == 200
    assert resp.json() == {"results": [{"id": "a"}], "total": 4170, "offset": 40, "page_size": 20}
    args, kwargs = query.call_args
    assert args == (20, 40)
    assert kwargs["user_id"] == "zach"
    assert kwargs["category"] == "work"
    assert kwargs["source"] == {"project": "norn-m"}
    assert kwargs["text"] == "pnpm"
    assert kwargs["show_expired"] is False
    memory.get_all.assert_not_called()


def test_page_size_is_bounded(api):
    client, _, _ = api
    assert client.get("/memories", params={"page_size": 0}).status_code == 422
    assert client.get("/memories", params={"page_size": memory_store.PAGE_SIZE_LIMIT + 1}).status_code == 422
    assert client.get("/memories", params={"page_size": 20, "offset": -1}).status_code == 422


def test_text_filter_applies_to_the_sdk_listing_too(api):
    client, _, memory = api
    memory.get_all.return_value = {"results": [{"id": "a", "memory": "Uses PNPM"}, {"id": "b", "memory": "Uses npm"}]}
    resp = client.get("/memories", params={"user_id": "zach", "q": "pnpm"})
    assert [m["id"] for m in resp.json()["results"]] == ["a"]


def test_sources_route_is_not_taken_for_a_memory_id(api):
    client, main, memory = api
    values = {"device": ["mac"], "agent": [], "project": [], "cwd": []}
    with patch.object(main, "list_source_values", return_value=values) as listed:
        resp = client.get("/memories/sources", params={"user_id": "zach"})
    assert resp.status_code == 200
    assert resp.json() == values
    assert listed.call_args.kwargs == {"scope": None, "user_id": "zach"}
    memory.get.assert_not_called()


# ---------------------------------------------------------------------------
# Hierarchy totals: the SQL aggregate the pyramid reads must match the Python scan
# ---------------------------------------------------------------------------


def _hierarchy_payloads():
    """Payload variants the layer aggregate has to fold: layers, string importance, junk, expired."""
    created = datetime(2026, 2, 1, tzinfo=timezone.utc).isoformat()
    return [
        {"data": "principle", "user_id": "zach", "layer": "L0", "importance": 10, "context": "chat", "created_at": created},
        {"data": "skill", "user_id": "zach", "layer": "L1", "importance": "8", "context": "project-a", "created_at": created},
        {"data": "event", "user_id": "alex", "layer": "L2", "importance": 6.5, "created_at": created},
        {"data": "scratch", "user_id": "zach", "layer": "L4", "importance": 2, "context": "debug-1", "created_at": created},
        {"data": "unknown layer", "user_id": "alex", "layer": "L9", "importance": 7, "created_at": created},
        {"data": "expired", "user_id": "zach", "layer": "L2", "importance": 4, "expiration_date": "2000-01-01", "created_at": created},
    ]


@pytest.mark.parametrize(
    "filters",
    [
        {},
        {"user_id": "zach"},
        {"show_expired": False},
        {"scope": KeyScope.build(categories=["work"])},
        {"user_id": "zach", "show_expired": False},
    ],
    ids=lambda f: ",".join(f) or "none",
)
def test_hierarchy_totals_match_the_python_scan(pg_store, filters):
    store, rows = pg_store
    extras = _hierarchy_payloads()
    ids = [str(uuid.uuid4()) for _ in extras]
    store.insert(vectors=[[0.1, 0.2, 0.3]] * len(extras), ids=ids, payloads=extras)
    rows.extend(SimpleNamespace(id=memory_id, payload=payload) for memory_id, payload in zip(ids, extras))

    with patch.object(memory_store, "get_memory_instance", return_value=SimpleNamespace(vector_store=store)):
        # Stats hide expired memories, like the listing does by default.
        expected_ids = {m["id"] for m in _scanned(rows, **{"show_expired": False, **filters})}
        payloads = [row.payload for row in rows if row.id in expected_ids]
        layers, contexts = memory_store.hierarchy_totals(**filters)

    assert (layers, contexts) == memory_store._layer_totals(payloads)
    assert set(layers) == set(memory_store.HIERARCHY_LAYERS)
