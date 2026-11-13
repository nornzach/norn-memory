"""Hierarchy statistics: what the dashboard pyramid aggregates, and who may see all of it."""

from types import SimpleNamespace

import memory_store
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from routers import hierarchy


def _memory(layer=None, importance=None, context=None):
    metadata = {}
    if layer is not None:
        metadata["layer"] = layer
    if importance is not None:
        metadata["importance"] = importance
    if context is not None:
        metadata["context"] = context
    return {"id": "m", "memory": "text", "metadata": metadata}


@pytest.fixture
def rows(monkeypatch):
    """Replace the store aggregate with fixture totals and record the filters it was asked for."""
    seen = {}
    payloads = [
        _memory("L0", 10, "chat"),
        _memory("L1", 8, "project-a"),
        _memory("L2", "6", "project-a"),  # legacy payloads store importance as a string
        _memory("L4", 2.5),
        _memory(),  # written before hierarchy fields existed
    ]

    def fake_totals(**filters):
        seen.update(filters)
        return memory_store._layer_totals(payload["metadata"] for payload in payloads)

    monkeypatch.setattr(hierarchy, "hierarchy_totals", fake_totals)
    monkeypatch.setattr(hierarchy.exact_store, "count_records", lambda user_ids: 7)
    return seen


def _client(scope=None, role="admin"):
    app = FastAPI()
    app.include_router(hierarchy.router)
    app.dependency_overrides[hierarchy.get_key_scope] = lambda: scope
    app.dependency_overrides[hierarchy.verify_auth] = lambda: SimpleNamespace(role=role)
    return TestClient(app)


def test_aggregates_layers_contexts_and_legacy_rows(rows):
    body = _client().get("/memories/hierarchy-stats").json()

    assert body["total_memories"] == 5
    assert body["by_layer"]["L0"]["count"] == 1
    assert body["by_layer"]["L1"]["count"] == 1
    assert body["by_layer"]["L2"]["avg_importance"] == 6.0
    assert body["by_layer"]["L3"]["count"] == 1  # no layer stored -> working
    assert body["by_layer"]["L3"]["avg_importance"] == 5.0
    assert body["by_layer"]["L4"]["avg_importance"] == 2.5
    assert body["context_distribution"] == {"chat": 3, "project-a": 2}
    assert body["avg_importance"] == round((10 + 8 + 6 + 2.5 + 5) / 5, 2)
    assert body["pyramid"][0] == {"layer": "L0", "label": "Canonical", "count": 1}
    assert body["exact_records"] == 7


def test_ids_are_passed_through_and_no_admin_needed(rows):
    response = _client(role="member").get("/memories/hierarchy-stats?user_id=alice")

    assert response.status_code == 200
    assert rows["user_id"] == "alice"


def test_listing_every_owner_needs_admin(rows):
    response = _client(role="member").get("/memories/hierarchy-stats")

    assert response.status_code == 403


def test_scoped_key_without_ids_is_allowed_and_limited(rows):
    class Scoped:
        restricts_entities = True
        user_ids: frozenset = frozenset()
        agent_ids: frozenset = frozenset()
        run_ids: frozenset = frozenset()
        categories: frozenset = frozenset()

    response = _client(scope=Scoped(), role="member").get("/memories/hierarchy-stats")

    assert response.status_code == 200
    assert rows["scope"] is not None
