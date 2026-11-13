"""Reconciling extracted facts against stored memories (Memory.add(..., reconcile=True))."""

import json
from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, Mock

import pytest

from norn_m.memory import reconcile
from norn_m.memory.main import AsyncMemory, Memory
from norn_m.memory.reconcile import Candidate, Decision

SCOPE = {"user_id": "zach"}


def _hit(memory_id, text, score, created_at="2026-11-01T10:00:00+00:00", **payload):
    return SimpleNamespace(
        id=memory_id, score=score, payload={"data": text, "created_at": created_at, **SCOPE, **payload}
    )


def _candidates(*texts):
    return [Candidate(id=f"m{i}", text=text) for i, text in enumerate(texts, 1)]


# ---------------------------------------------------------------------------
# Candidates
# ---------------------------------------------------------------------------


def test_candidates_keep_close_hits_in_the_same_scope_once_best_first():
    neighbors = [
        [_hit("a", "Uses Python 3.11", 0.91), _hit("b", "Prefers pnpm", 0.4)],
        [_hit("a", "Uses Python 3.11", 0.95), _hit("c", "Deploys with Docker", 0.7)],
        [_hit("d", "Uses Python 3.12 in run x", 0.99, run_id="x"), _hit("e", "", 0.99)],
    ]

    found = reconcile.gather_candidates(neighbors, SCOPE)

    assert [(c.id, c.text) for c in found] == [("a", "Uses Python 3.11"), ("c", "Deploys with Docker")]


def test_prompt_numbers_memories_and_facts_from_one_with_dates():
    messages = reconcile.build_messages(
        ["Uses Python 3.12"], [Candidate("a", "Uses Python 3.11", "2026-10-02T08:00:00+00:00")]
    )

    assert messages[0]["role"] == "system" and '"replace"' in messages[0]["content"]
    assert "id 1: (2026-10-02) Uses Python 3.11" in messages[1]["content"]
    assert "fact 1: Uses Python 3.12" in messages[1]["content"]


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------


def test_parse_reads_each_action_and_converts_to_zero_based():
    reply = json.dumps(
        {
            "decisions": [
                {"fact": 1, "action": "add"},
                {"fact": 2, "action": "skip", "existing": [2]},
                {"fact": 3, "action": "update", "existing": [1, 3], "text": " merged "},
                {"fact": 4, "action": "REPLACE", "existing": 4},
            ]
        }
    )

    decisions = reconcile.parse_decisions(reply, 4, 4)

    assert decisions == {
        0: Decision(0, "add", [], None),
        1: Decision(1, "skip", [1], None),
        2: Decision(2, "update", [0, 2], "merged"),
        3: Decision(3, "replace", [3], None),
    }


@pytest.mark.parametrize(
    "item",
    [
        {"fact": 9, "action": "add"},  # no such fact
        {"fact": 1, "action": "forget"},  # unknown action
        {"fact": 1, "action": "skip", "existing": [7]},  # no such memory
        {"fact": 1, "action": "update", "existing": [1]},  # update without text
        {"fact": True, "action": "skip", "existing": [1]},  # bool is not a number
        "nonsense",
    ],
)
def test_parse_drops_invalid_decisions(item):
    assert reconcile.parse_decisions(json.dumps({"decisions": [item]}), 2, 2) == {}


@pytest.mark.parametrize("reply", ["", "not json", "{broken", '{"decisions": "add"}', None, {"content": "[]"}])
def test_parse_survives_malformed_replies(reply):
    assert reconcile.parse_decisions(reply, 2, 2) == {}


def test_parse_takes_a_bare_list_wrapped_in_prose_and_the_first_decision_per_fact():
    reply = 'Sure: [{"fact": 1, "action": "skip", "existing": [1]}, {"fact": 1, "action": "add"}]'

    assert reconcile.parse_decisions(reply, 1, 1) == {0: Decision(0, "skip", [0], None)}


# ---------------------------------------------------------------------------
# Planning
# ---------------------------------------------------------------------------


def test_plan_maps_decisions_to_ids_and_adds_facts_without_one():
    facts = ["f1", "f2", "f3", "f4"]
    candidates = _candidates("c1", "c2", "c3", "c4")
    decisions = {
        1: Decision(1, "skip", [1]),
        2: Decision(2, "update", [0, 2], "merged"),
        3: Decision(3, "replace", [3]),
    }

    plan = reconcile.build_plan(decisions, facts, candidates)

    assert plan.add == [0]
    assert plan.skip == [(1, "m2")]
    assert plan.update == [(2, "m1", "merged"), (3, "m4", "f4")]
    assert plan.delete == [(2, "m3")]


def test_plan_turns_conflicting_decisions_into_adds():
    facts = ["f1", "f2", "f3", "f4"]
    candidates = _candidates("c1", "c2")
    decisions = {
        0: Decision(0, "update", [0, 1], "merged"),  # rewrites m1, deletes m2
        1: Decision(1, "skip", [1]),  # m2 is gone: add instead
        2: Decision(2, "replace", [0]),  # m1 was already rewritten: add instead
        3: Decision(3, "skip", [0]),  # m1 still exists: fine
    }

    plan = reconcile.build_plan(decisions, facts, candidates)

    assert plan.update == [(0, "m1", "merged")]
    assert plan.delete == [(0, "m2")]
    assert plan.add == [1, 2]
    assert plan.skip == [(3, "m1")]


def test_plan_does_not_rewrite_a_memory_another_fact_skipped_on():
    plan = reconcile.build_plan(
        {0: Decision(0, "skip", [0]), 1: Decision(1, "replace", [0])}, ["f1", "f2"], _candidates("c1")
    )

    assert plan.skip == [(0, "m1")] and plan.add == [1] and plan.update == []


def test_result_entries_report_changes_and_leave_out_failures():
    facts = ["f1", "f2", "f3"]
    candidates = _candidates("c1", "c2", "c3", "c4")
    plan = reconcile.Plan(
        skip=[(0, "m1")],
        update=[(1, "m2", "merged"), (2, "m4", "f3")],
        delete=[(1, "m3"), (2, "m1")],
    )

    entries = reconcile.result_entries(plan, facts, candidates, failed_facts={2}, failed_deletes={"m3"})

    assert entries == [
        {"id": "m2", "memory": "merged", "event": "UPDATE", "previous_memory": "c2"},
        {"id": "m1", "memory": "c1", "event": "NONE", "fact": "f1"},
    ]


# ---------------------------------------------------------------------------
# Memory.add(..., reconcile=True)
# ---------------------------------------------------------------------------


class FakeStore:
    """A vector store holding rows by id; search returns the configured hits for each query text."""

    def __init__(self, rows, hits_by_query):
        self.rows = {r.id: r for r in rows}
        self.hits_by_query = hits_by_query
        self.inserted = []

    def search(self, query, vectors, top_k, filters):
        return self.hits_by_query.get(query, [])[:top_k]

    def get(self, vector_id):
        return self.rows.get(vector_id)

    def insert(self, vectors, ids, payloads):
        self.inserted.extend(zip(ids, payloads))

    def update(self, vector_id, vector=None, payload=None):
        self.rows[vector_id] = SimpleNamespace(id=vector_id, score=None, payload=payload)

    def delete(self, vector_id):
        del self.rows[vector_id]


STORED = [
    _hit("py", "Uses Python 3.11", 0.9),
    _hit("pnpm", "Prefers pnpm over npm", 0.9),
    _hit("pnpm-dup", "Uses pnpm, not npm", 0.9),
    _hit("tz", "Lives in UTC+8", 0.9),
]
FACTS = ["Uses Python 3.12", "Prefers pnpm and never yarn", "Lives in UTC+8 (Beijing)", "Likes dark mode"]
HITS = {
    "Uses Python 3.12": [STORED[0]],
    "Prefers pnpm and never yarn": [STORED[1], STORED[2]],
    "Lives in UTC+8 (Beijing)": [STORED[3]],
    "Likes dark mode": [],
}
EXTRACTION = json.dumps({"memory": [{"id": str(i), "text": t} for i, t in enumerate(FACTS)]})
DECISIONS = {
    "decisions": [
        {"fact": 1, "action": "replace", "existing": [1]},
        {"fact": 2, "action": "update", "existing": [2, 3], "text": "Prefers pnpm over npm and never uses yarn"},
        {"fact": 3, "action": "skip", "existing": [4]},
        {"fact": 4, "action": "add"},
    ]
}


def _wire(memory, mocker):
    memory.config = MagicMock()
    memory.custom_instructions = None
    memory.db = MagicMock()
    memory.db.get_last_messages = MagicMock(return_value=[])
    memory.vector_store = FakeStore(
        [SimpleNamespace(id=h.id, score=None, payload=dict(h.payload)) for h in STORED], HITS
    )
    memory.embedding_model = MagicMock()
    memory.embedding_model.embed.return_value = [0.1, 0.2, 0.3]
    memory.embedding_model.embed_batch.side_effect = lambda texts, action: [[0.1, 0.2, 0.3] for _ in texts]
    memory.llm = MagicMock()
    memory.llm.generate_response.side_effect = [EXTRACTION, json.dumps(DECISIONS)]
    mocker.patch("norn_m.memory.main.extract_entities_batch", return_value=[])
    return memory


def _assert_reconciled(memory, results):
    store = memory.vector_store
    by_event = {}
    for r in results:
        by_event.setdefault(r["event"], []).append(r)

    assert [r["memory"] for r in by_event["ADD"]] == ["Likes dark mode"]
    assert [p["data"] for _, p in store.inserted] == ["Likes dark mode"]
    assert {(r["id"], r["memory"], r["previous_memory"]) for r in by_event["UPDATE"]} == {
        ("py", "Uses Python 3.12", "Uses Python 3.11"),
        ("pnpm", "Prefers pnpm over npm and never uses yarn", "Prefers pnpm over npm"),
    }
    assert store.rows["py"].payload["data"] == "Uses Python 3.12"
    assert [(r["id"], r["memory"]) for r in by_event["DELETE"]] == [("pnpm-dup", "Uses pnpm, not npm")]
    assert "pnpm-dup" not in store.rows
    assert by_event["NONE"] == [
        {"id": "tz", "memory": "Lives in UTC+8", "event": "NONE", "fact": "Lives in UTC+8 (Beijing)"}
    ]
    reconcile_call = memory.llm.generate_response.call_args_list[1]
    assert "fact 4: Likes dark mode" in reconcile_call.kwargs["messages"][1]["content"]


@pytest.fixture
def sync_memory(mocker):
    memory = Memory.__new__(Memory)
    memory._remove_memory_from_entity_store = MagicMock()
    memory._link_entities_for_memory = MagicMock()
    memory._entity_store = None
    return _wire(memory, mocker)


@pytest.fixture
def async_memory(mocker):
    memory = AsyncMemory.__new__(AsyncMemory)
    memory._remove_memory_from_entity_store = AsyncMock()
    memory._link_entities_for_memory = AsyncMock()
    memory._entity_store = None
    return _wire(memory, mocker)


def test_add_with_reconcile_applies_each_decision(sync_memory):
    results = sync_memory._add_to_vector_store(
        [{"role": "user", "content": "chat"}], {"user_id": "zach"}, SCOPE, infer=True, reconcile=True
    )

    _assert_reconciled(sync_memory, results)


@pytest.mark.asyncio
async def test_async_add_with_reconcile_applies_each_decision(async_memory):
    results = await async_memory._add_to_vector_store(
        [{"role": "user", "content": "chat"}], {"user_id": "zach"}, SCOPE, infer=True, reconcile=True
    )

    _assert_reconciled(async_memory, results)


def test_add_stores_hierarchy_fields(sync_memory):
    """Every stored memory carries the layer, importance and context the pyramid and ranking read."""
    sync_memory._add_to_vector_store(
        [{"role": "user", "content": "chat"}],
        {"user_id": "zach", "project": "norn"},
        {"user_id": "zach", "agent_id": "cli", "run_id": None},
        infer=True,
    )

    payload = sync_memory.vector_store.inserted[0][1]
    assert payload["layer"] == "L2"  # no importance from the LLM -> 5.0
    assert payload["importance"] == 5.0
    assert payload["context"] == "project-norn"
    assert payload["last_accessed_at"] == payload["created_at"]


def test_add_without_reconcile_only_adds(sync_memory):
    sync_memory.llm.generate_response.side_effect = [EXTRACTION]

    results = sync_memory._add_to_vector_store(
        [{"role": "user", "content": "chat"}], {"user_id": "zach"}, SCOPE, infer=True
    )

    assert [r["event"] for r in results] == ["ADD"] * 4
    assert sync_memory.llm.generate_response.call_count == 1


def test_reconcile_skips_the_llm_when_nothing_similar_is_stored(sync_memory):
    sync_memory.vector_store.hits_by_query = {}
    sync_memory.llm.generate_response.side_effect = [EXTRACTION]

    results = sync_memory._add_to_vector_store(
        [{"role": "user", "content": "chat"}], {"user_id": "zach"}, SCOPE, infer=True, reconcile=True
    )

    assert [r["event"] for r in results] == ["ADD"] * 4
    assert sync_memory.llm.generate_response.call_count == 1


def test_reconcile_adds_everything_when_its_llm_call_fails(sync_memory):
    sync_memory.llm.generate_response.side_effect = [EXTRACTION, RuntimeError("provider down")]

    results = sync_memory._add_to_vector_store(
        [{"role": "user", "content": "chat"}], {"user_id": "zach"}, SCOPE, infer=True, reconcile=True
    )

    assert [r["event"] for r in results] == ["ADD"] * 4
    assert set(sync_memory.vector_store.rows) == {"py", "pnpm", "pnpm-dup", "tz"}


def test_a_failed_update_adds_the_fact_and_keeps_its_other_memories(sync_memory):
    real_update = sync_memory._update_memory

    def update(memory_id, data, existing_embeddings, metadata=None):
        if memory_id == "pnpm":
            raise RuntimeError("store unavailable")
        return real_update(memory_id, data, existing_embeddings, metadata)

    sync_memory._update_memory = Mock(side_effect=update)

    results = sync_memory._add_to_vector_store(
        [{"role": "user", "content": "chat"}], {"user_id": "zach"}, SCOPE, infer=True, reconcile=True
    )

    added = sorted(r["memory"] for r in results if r["event"] == "ADD")
    assert added == ["Likes dark mode", "Prefers pnpm and never yarn"]
    assert "pnpm-dup" in sync_memory.vector_store.rows
    assert not [r for r in results if r["event"] == "DELETE"]


def test_public_add_passes_reconcile_through(mocker):
    memory = Memory.__new__(Memory)
    memory.config = MagicMock()
    memory.config.llm.config.get.return_value = False
    memory._add_to_vector_store = MagicMock(return_value=[])

    memory.add("I moved to Berlin", user_id="zach", reconcile=True)

    assert memory._add_to_vector_store.call_args.kwargs["reconcile"] is True


def _single_extraction(text, **fields):
    return json.dumps({"memory": [{"id": "0", "text": text, **fields}]})


def test_transient_memories_get_a_default_expiry(sync_memory):
    """L4 is the transient layer: without a caller-set date it expires instead of living forever."""
    sync_memory.llm.generate_response.side_effect = [_single_extraction("debug scratch", importance=2)]

    sync_memory._add_to_vector_store(
        [{"role": "user", "content": "chat"}], {"user_id": "zach"}, SCOPE, infer=True
    )

    payload = sync_memory.vector_store.inserted[0][1]
    assert payload["layer"] == "L4" and payload["importance"] == 2.0
    expiry = date.fromisoformat(payload["expiration_date"])
    assert date.today() + timedelta(days=29) <= expiry <= date.today() + timedelta(days=31)


def test_caller_expiry_wins_over_the_transient_default(sync_memory):
    sync_memory.llm.generate_response.side_effect = [_single_extraction("debug scratch", importance=2)]

    sync_memory._add_to_vector_store(
        [{"role": "user", "content": "chat"}],
        {"user_id": "zach", "expiration_date": "2999-01-01"},
        SCOPE,
        infer=True,
    )

    payload = sync_memory.vector_store.inserted[0][1]
    assert payload["expiration_date"] == "2999-01-01"


def test_stable_layers_do_not_expire_by_default(sync_memory):
    sync_memory.llm.generate_response.side_effect = [_single_extraction("Uses pnpm", importance=8)]

    sync_memory._add_to_vector_store(
        [{"role": "user", "content": "chat"}], {"user_id": "zach"}, SCOPE, infer=True
    )

    payload = sync_memory.vector_store.inserted[0][1]
    assert payload["layer"] == "L1"
    assert "expiration_date" not in payload
