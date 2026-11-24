import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import distill_legacy_memories as distill


def row(id_, text, project="demo", layer="L2", created_at="2026-11-01T00:00:00+00:00", role="assistant"):
    return SimpleNamespace(
        id=id_,
        payload={
            "data": text,
            "user_id": "zach",
            "role": role,
            "created_at": created_at,
            "hash": f"hash-{text}",
            "project": project,
            "layer": layer,
        },
    )


def test_eligible_rows_excludes_episodes_transient_rows_and_duplicates(monkeypatch):
    monkeypatch.setattr(distill.secret_guard, "find_secrets", lambda text: [])
    rows = distill.eligible_rows(
        [
            row("1", "same"),
            row("2", "same"),
            row("3", "temporary", layer="L4"),
            row("4", "other", project="other"),
        ],
        user_id="zach",
        since=datetime(2026, 10, 1, tzinfo=timezone.utc),
        until=datetime(2026, 12, 1, tzinfo=timezone.utc),
        projects={"demo"},
        layers={"L1", "L2"},
    )
    assert [item["id"] for item in rows] == ["1"]


def test_batches_are_project_scoped_and_deterministic(monkeypatch):
    monkeypatch.setattr(distill.secret_guard, "find_secrets", lambda text: [])
    rows = [row("2", "b", project="b"), row("1", "a", project="a"), row("3", "c", project="a")]
    result = list(
        distill.batches(
            distill.eligible_rows(rows, user_id="zach", since=None, until=None, projects=None, layers={"L2"}), 2
        )
    )
    assert [(project, [item["id"] for item in chunk]) for project, chunk in result] == [
        ("a", ["1", "3"]),
        ("b", ["2"]),
    ]


def test_offset_and_limit_select_stable_eligible_rows(monkeypatch):
    monkeypatch.setattr(distill.secret_guard, "find_secrets", lambda text: [])
    rows = distill.eligible_rows(
        [row("3", "third"), row("1", "first"), row("2", "second")],
        user_id="zach",
        since=None,
        until=None,
        projects={"demo"},
        layers={"L2"},
    )
    assert [item["id"] for item in rows[1:3]] == ["2", "3"]


def test_invalid_batch_is_split_until_valid_or_singleton(monkeypatch):
    source_rows = [
        {"id": str(index), "memory": f"memory-{index}", "metadata": {"project": "demo"}, "hash": str(index)}
        for index in range(1, 5)
    ]
    calls = []

    class Candidate:
        evidence_refs = [1]

    def extract(messages, _scope, _task_id):
        calls.append(len(messages))
        if len(messages) > 1:
            raise RuntimeError("Knowledge extraction returned an invalid proposal.")
        return [Candidate()]

    monkeypatch.setattr(distill.knowledge, "extract", extract)
    monkeypatch.setattr(distill, "_source", lambda row: {"memory_id": row["id"], "fingerprint": row["id"]})
    monkeypatch.setattr(distill.knowledge, "namespace", lambda params: params)
    result = distill.distill_batch(source_rows, user_id="zach", project="demo", apply=False, max_content=1200)

    assert result == {"split": 3, "candidates": 4}
    assert calls == [4, 2, 1, 1, 2, 1, 1]
