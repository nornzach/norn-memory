"""Tests for the self-hosted server's memory consolidation (merge / supersede proposals).

The LLM, embedder and vector store are faked; the run and proposal tables live in an
in-memory SQLite database so the router and background task run against real rows.
"""

import math
import os
import sys
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

pytest.importorskip("fastapi", reason="fastapi not installed")
pytest.importorskip("httpx", reason="httpx not installed")

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

SERVER_DIR = Path(__file__).resolve().parent.parent / "server"
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

TEST_ENV = {
    "JWT_SECRET": "test-secret-for-pytest-only-0123456789",
    "OPENAI_API_KEY": "fake-key",
    "NORN_M_TELEMETRY": "false",
}


@pytest.fixture(scope="module", autouse=True)
def _server_env():
    with patch.dict(os.environ, TEST_ENV):
        yield


def _row(memory_id, text, created_at, **scope):
    return SimpleNamespace(id=memory_id, payload={"data": text, "created_at": created_at, **scope})


class FakeMemory:
    """Just enough of norn_m.Memory: embeddings come from a fixed table, search is cosine similarity."""

    def __init__(self, rows, vectors, llm_replies):
        self.rows = {r.id: r for r in rows}
        self.vectors = vectors
        self.llm = MagicMock()
        self.llm.generate_response.side_effect = list(llm_replies)
        self.embedding_model = MagicMock()
        self.embedding_model.embed_batch.side_effect = lambda texts, action: [self.vectors[t] for t in texts]
        self.vector_store = MagicMock()
        self.vector_store.search.side_effect = self._search
        self.vector_store.get.side_effect = lambda vector_id: self.rows.get(vector_id)
        self.update = MagicMock(side_effect=self._update)
        self.delete = MagicMock(side_effect=lambda memory_id: self.rows.pop(memory_id))

    def _search(self, query, vectors, top_k, filters):
        def cosine(a, b):
            return sum(x * y for x, y in zip(a, b)) / (math.hypot(*a) * math.hypot(*b))

        hits = [
            SimpleNamespace(id=r.id, score=cosine(vectors, self.vectors[r.payload["data"]]), payload=r.payload)
            for r in self.rows.values()
            if all(r.payload.get(k) == v for k, v in filters.items())
        ]
        return sorted(hits, key=lambda h: -h.score)[:top_k]

    def _update(self, memory_id, text):
        self.rows[memory_id].payload["data"] = text


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


class TestCluster:
    def test_groups_transitively_and_drops_singletons(self):
        import consolidator

        groups = consolidator.cluster(["a", "b", "c", "d", "e"], [("a", "b"), ("c", "b"), ("d", "x")])
        assert groups == [["a", "b", "c"]]

    def test_caps_group_size(self):
        import consolidator

        ids = [str(i) for i in range(5)]
        groups = consolidator.cluster(ids, [(ids[i], ids[i + 1]) for i in range(4)], max_size=3)
        assert groups == [["0", "1", "2"]]


class TestParseDecision:
    def _parse(self, reply, count=3):
        import consolidator

        return consolidator.parse_decision(reply, count)

    def test_merge_converts_to_zero_based_sorted_indices(self):
        reply = (
            'Here:\n```json\n{"action": "merge", "text": "Likes green tea", "sources": [3, 1, 1], "reason": "dup"}\n```'
        )
        assert self._parse(reply) == {"kind": "merge", "sources": [0, 2], "text": "Likes green tea", "reason": "dup"}

    def test_supersede_drops_current_from_outdated(self):
        reply = '{"action": "supersede", "current": 2, "outdated": [1, 2], "reason": "moved"}'
        assert self._parse(reply) == {"kind": "supersede", "current": 1, "outdated": [0], "reason": "moved"}

    @pytest.mark.parametrize(
        "reply",
        [
            '{"action": "keep", "reason": "distinct"}',
            '{"action": "merge", "text": "x", "sources": [1]}',
            '{"action": "merge", "text": "", "sources": [1, 2]}',
            '{"action": "merge", "text": "x", "sources": [1, 9]}',
            '{"action": "supersede", "current": 4, "outdated": [1]}',
            '{"action": "supersede", "current": true, "outdated": [2]}',
            '{"action": "supersede", "current": 1, "outdated": [1]}',
            '{"action": "delete_everything"}',
            "not json",
            None,
        ],
    )
    def test_keep_and_invalid_replies_propose_nothing(self, reply):
        assert self._parse(reply) is None

    def test_reads_content_from_dict_replies(self):
        reply = {"content": '{"action": "supersede", "current": "2", "outdated": ["1"]}'}
        assert self._parse(reply, 2)["outdated"] == [0]


class TestSimilarPairs:
    def test_keeps_close_neighbors_in_the_same_scope_only(self):
        import consolidator

        rows = [
            _row("tea1", "tea", "1", user_id="alice"),
            _row("tea2", "green tea", "2", user_id="alice"),
            _row("tea3", "tea again", "3", user_id="alice", agent_id="bot"),
            _row("ski", "skiing", "4", user_id="alice"),
        ]
        vectors = {"tea": [1, 0], "green tea": [0.99, 0.1], "tea again": [1, 0.01], "skiing": [0, 1]}
        memory = FakeMemory(rows, vectors, [])

        with patch.object(consolidator, "get_memory_instance", return_value=memory):
            pairs = consolidator.similar_pairs(rows, 0.9)

        # tea3 has an agent_id, so it is a different scope even though alice's search can't exclude it.
        assert sorted(pairs) == [("tea1", "tea2"), ("tea2", "tea1")]


class TestBuildAction:
    MEMORIES = [
        {"id": "old", "memory": "Lives in Paris"},
        {"id": "mid", "memory": "Lives in Paris, France"},
        {"id": "new", "memory": "Moved to Berlin"},
    ]

    def test_merge_rewrites_the_oldest_source(self):
        import consolidator

        action = consolidator.build_action(
            "run", self.MEMORIES, {"kind": "merge", "sources": [0, 1], "text": "Lives in Paris, France", "reason": ""}
        )
        assert (action.target_id, action.remove_ids, action.new_text) == ("old", ["mid"], "Lives in Paris, France")
        assert [s["id"] for s in action.sources] == ["old", "mid"]

    def test_supersede_keeps_current_and_removes_outdated(self):
        import consolidator

        action = consolidator.build_action(
            "run", self.MEMORIES, {"kind": "supersede", "current": 2, "outdated": [0, 1], "reason": ""}
        )
        assert (action.target_id, action.remove_ids, action.new_text) == ("new", ["old", "mid"], None)


# ---------------------------------------------------------------------------
# Router + background run, against SQLite
# ---------------------------------------------------------------------------


ROWS = [
    _row("paris", "Lives in Paris", "2026-01-01", user_id="alice"),
    _row("tea1", "Likes green tea", "2026-02-01", user_id="alice"),
    _row("tea2", "Enjoys green tea", "2026-03-01", user_id="alice"),
    _row("berlin", "Moved to Berlin", "2026-04-01", user_id="alice"),
    _row("bob", "Likes green tea", "2026-02-15", user_id="bob"),
]
VECTORS = {
    "Lives in Paris": [0, 1, 0.1],
    "Moved to Berlin": [0, 1, 0.2],
    "Likes green tea": [1, 0, 0],
    "Enjoys green tea": [0.98, 0.05, 0],
}
# Groups come back in scan order (oldest first): Paris/Berlin, then the two teas.
REPLIES = [
    '{"action": "supersede", "current": 2, "outdated": [1], "reason": "Moved"}',
    '{"action": "merge", "text": "Likes green tea", "sources": [1, 2], "reason": "Same fact"}',
]


@pytest.fixture
def harness():
    import categorizer
    import consolidator
    from auth import require_admin_or_scoped, verify_auth
    from db import Base, get_db
    from models import ConsolidationAction, ConsolidationRun
    from routers import consolidation

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine, tables=[ConsolidationRun.__table__, ConsolidationAction.__table__])
    Session = sessionmaker(bind=engine)

    def _db():
        with Session() as db:
            yield db

    app = FastAPI()
    app.include_router(consolidation.router)
    app.dependency_overrides[verify_auth] = lambda: None
    app.dependency_overrides[require_admin_or_scoped] = lambda: None
    app.dependency_overrides[get_db] = _db

    memory = FakeMemory([SimpleNamespace(id=r.id, payload=dict(r.payload)) for r in ROWS], VECTORS, REPLIES)
    with ExitStack() as stack:
        stack.enter_context(patch.object(consolidator, "SessionLocal", Session))
        stack.enter_context(patch.object(consolidator, "list_rows", side_effect=lambda: list(memory.rows.values())))
        stack.enter_context(patch.object(consolidator, "get_memory_instance", return_value=memory))
        emit = stack.enter_context(patch.object(consolidator.webhooks, "emit"))
        categorize = stack.enter_context(patch.object(categorizer, "categorize_memories"))
        yield SimpleNamespace(client=TestClient(app), memory=memory, emit=emit, categorize=categorize)
    assert not consolidator.run_lock.locked()


def _start(client, **body):
    resp = client.post("/consolidation/runs", json={"user_id": "alice", "threshold": 0.9, **body})
    assert resp.status_code == 202, resp.text
    return client.get(f"/consolidation/runs/{resp.json()['id']}").json()


class TestConsolidationFlow:
    def test_run_proposes_without_changing_memories(self, harness):
        run = _start(harness.client)

        assert run["status"] == "completed"
        assert (run["memories_scanned"], run["clusters_found"]) == (4, 2)
        assert run["actions"] == {"proposed": 2}
        supersede, merge = run["proposals"]
        assert (supersede["kind"], supersede["target_id"], supersede["remove_ids"]) == (
            "supersede",
            "berlin",
            ["paris"],
        )
        assert (merge["kind"], merge["target_id"], merge["remove_ids"]) == ("merge", "tea1", ["tea2"])
        assert "bob" in harness.memory.rows and len(harness.memory.rows) == 5
        harness.memory.update.assert_not_called()
        harness.memory.delete.assert_not_called()

    def test_applying_a_merge_rewrites_deletes_and_recategorizes(self, harness):
        merge = _start(harness.client)["proposals"][1]

        resp = harness.client.post(f"/consolidation/proposals/{merge['id']}/apply")

        assert resp.json()["status"] == "applied"
        harness.memory.update.assert_called_once_with("tea1", text="Likes green tea")
        harness.memory.delete.assert_called_once_with(memory_id="tea2")
        assert [c.args[0] for c in harness.emit.call_args_list] == ["memory.updated", "memory.deleted"]
        harness.categorize.assert_called_once_with([("tea1", "Likes green tea")])
        assert harness.client.post(f"/consolidation/proposals/{merge['id']}/apply").status_code == 409

    def test_changed_memory_makes_the_proposal_stale(self, harness):
        supersede = _start(harness.client)["proposals"][0]
        harness.memory.rows["paris"].payload["data"] = "Lives in Paris (edited)"

        resp = harness.client.post(f"/consolidation/proposals/{supersede['id']}/apply")

        assert resp.json()["status"] == "stale"
        harness.memory.delete.assert_not_called()

    def test_apply_all_then_dismissed_and_run_counts(self, harness):
        run = _start(harness.client)
        harness.client.post(f"/consolidation/proposals/{run['proposals'][0]['id']}/dismiss")

        resp = harness.client.post(f"/consolidation/runs/{run['id']}/apply")

        assert resp.json() == {"applied": 1, "stale": 0, "failed": 0}
        assert "paris" in harness.memory.rows and "tea2" not in harness.memory.rows
        listed = harness.client.get("/consolidation/runs").json()
        assert listed[0]["actions"] == {"dismissed": 1, "applied": 1}

    def test_failed_scan_marks_the_run_failed_and_releases_the_lock(self, harness):
        harness.memory.embedding_model.embed_batch.side_effect = RuntimeError("embedder down")

        run = _start(harness.client)

        assert (run["status"], run["error"]) == ("failed", "embedder down")
        harness.memory.embedding_model.embed_batch.side_effect = None
        harness.memory.embedding_model.embed_batch.return_value = []
        assert _start(harness.client)["status"] == "completed"

    def test_a_second_run_is_refused_while_one_is_running(self, harness):
        import consolidator

        assert consolidator.run_lock.acquire(blocking=False)
        try:
            resp = harness.client.post("/consolidation/runs", json={})
        finally:
            consolidator.run_lock.release()
        assert resp.status_code == 409

    def test_threshold_is_validated(self, harness):
        assert harness.client.post("/consolidation/runs", json={"threshold": 1.5}).status_code == 422
