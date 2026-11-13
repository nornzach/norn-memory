"""Hierarchy evolution decisions, tested against the pure decide() function and the tick loop."""

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch


SERVER_DIR = Path(__file__).resolve().parent.parent / "server"
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

import evolve  # noqa: E402

NOW = datetime(2026, 11, 14, tzinfo=timezone.utc)


def _payload(**extra):
    return {"data": "memory", "created_at": (NOW - timedelta(days=40)).isoformat(), **extra}


def test_canonical_never_moves():
    assert evolve.decide(_payload(layer="L0", importance=1, access_count=0), NOW) is None


def test_frequently_accessed_transient_is_promoted():
    change = evolve.decide(_payload(layer="L4", access_count=4, last_accessed_at=NOW.isoformat()), NOW)
    kind, fields = change
    assert kind == "layer" and fields["layer"] == "L3"
    assert fields["access_count"] == 0 and "demoted_at" in fields


def test_idle_working_memory_demotes_to_transient_with_an_expiry():
    # Younger than the 7-day L3→L2 age rule, so promotion can't pre-empt demotion.
    created = (NOW - timedelta(days=3)).isoformat()
    idle = (NOW - timedelta(days=10)).isoformat()
    change = evolve.decide(_payload(layer="L3", importance=2, created_at=created, last_accessed_at=idle), NOW)
    kind, fields = change
    assert kind == "layer" and fields["layer"] == "L4"
    assert fields["expiration_date"] > NOW.date().isoformat()


def test_ignored_transient_expires_instead_of_being_deleted():
    idle = (NOW - timedelta(days=10)).isoformat()
    change = evolve.decide(_payload(layer="L4", importance=2, access_count=0, last_accessed_at=idle), NOW)
    assert change is not None and change[0] == "expire"


def test_core_memory_stays_put_when_idle():
    idle = (NOW - timedelta(days=60)).isoformat()
    assert evolve.decide(_payload(layer="L1", importance=9, last_accessed_at=idle), NOW) is None


def test_tick_writes_layer_changes_and_history(monkeypatch):
    idle = (NOW - timedelta(days=10)).isoformat()
    rows = [
        SimpleNamespace(id="m1", payload=_payload(layer="L4", access_count=5, last_accessed_at=NOW.isoformat())),
        SimpleNamespace(
            id="m2",
            payload=_payload(
                layer="L3",
                importance=2,
                created_at=(NOW - timedelta(days=3)).isoformat(),
                last_accessed_at=idle,
            ),
        ),
        SimpleNamespace(id="m3", payload=_payload(layer="L1", importance=9)),
    ]
    store = MagicMock()
    db = MagicMock()
    monkeypatch.setattr(evolve.memory_store, "list_rows", lambda: rows)
    monkeypatch.setattr(
        evolve, "get_memory_instance", lambda: SimpleNamespace(vector_store=store, db=db)
    )

    stats = evolve.evolve_tick(NOW)

    assert stats == {"scanned": 3, "promoted": 1, "demoted": 1, "expired": 0, "errors": 0}
    calls = {c.kwargs["vector_id"]: c.kwargs["payload"] for c in store.update.call_args_list}
    assert calls["m1"]["layer"] == "L3"
    assert calls["m2"]["layer"] == "L4" and "expiration_date" in calls["m2"]
    assert "m3" not in calls
    assert db.add_history.call_count == 2
    events = {c.args[0]: c.args[3] for c in db.add_history.call_args_list}
    assert set(events.values()) == {"LAYER"}


def test_demoted_memory_cannot_drift_back_on_age():
    """The ping-pong guard: an L2 demoted for idleness stays L3 until somebody reads it."""
    idle = (NOW - timedelta(days=40)).isoformat()
    demoted = _payload(layer="L3", importance=4, last_accessed_at=idle, demoted_at=idle)
    assert evolve.decide(demoted, NOW) is None  # age alone no longer promotes it


def test_demotion_beats_promotion_when_both_match():
    """An old, idle L3 is decaying — demote-first, no rescue from the age rule."""
    old_idle = (NOW - timedelta(days=10)).isoformat()
    change = evolve.decide(_payload(layer="L3", importance=2, created_at=old_idle, last_accessed_at=old_idle), NOW)
    assert change is not None and change[1]["layer"] == "L4"
    assert change[1]["demoted_at"] == NOW.isoformat()


def test_access_redeems_a_demoted_memory_and_clears_the_marker():
    demoted = _payload(
        layer="L3",
        importance=4,
        access_count=3,
        last_accessed_at=NOW.isoformat(),
        demoted_at=(NOW - timedelta(days=5)).isoformat(),
    )
    kind, fields = evolve.decide(demoted, NOW)
    assert kind == "layer" and fields["layer"] == "L2" and fields["demoted_at"] is None


def test_tick_drops_the_demoted_at_key_from_payloads():
    idle = (NOW - timedelta(days=40)).isoformat()
    row = SimpleNamespace(id="m1", payload=_payload(layer="L3", importance=4, access_count=3,
                                                  last_accessed_at=NOW.isoformat(), demoted_at=idle))
    store = MagicMock()
    with (
        patch.object(evolve.memory_store, "list_rows", return_value=[row]),
        patch.object(evolve, "get_memory_instance", return_value=SimpleNamespace(vector_store=store, db=MagicMock())),
    ):
        evolve.evolve_tick(NOW)
    written = store.update.call_args.kwargs["payload"]
    assert written["layer"] == "L2" and "demoted_at" not in written
