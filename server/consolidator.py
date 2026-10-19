"""LLM-driven consolidation of near-duplicate and outdated memories.

Memory.add() in the OSS SDK only ever adds rows, so restatements and stale facts pile up
("lives in Paris" next to "moved to Berlin"). A run groups memories that share a scope by
embedding similarity, asks the LLM what to do with each group, and stores the answer as a
proposal. Nothing changes until a proposal is applied:

- merge: the oldest source is rewritten with the combined text and the other sources are deleted.
- supersede: the outdated memories are deleted and the current one is kept.

The text of every memory a proposal touches is kept on the proposal, so a deleted memory
can still be read (and restored by hand) afterwards.
"""

import json
import logging
import re
import threading
import uuid
from datetime import datetime, timezone
from typing import Any, Iterable, Optional

import webhooks
from db import SessionLocal
from memory_store import list_rows
from models import ConsolidationAction, ConsolidationRun
from server_state import get_memory_instance

# Restatements score ~0.85+, but contradictions ("lives in Paris" / "moved to Berlin") often only ~0.7,
# so the default leans low and lets the LLM answer "keep" for related-but-distinct groups.
DEFAULT_THRESHOLD = 0.8
MAX_MEMORIES_PER_RUN = 500
NEIGHBORS = 6
MAX_CLUSTER_SIZE = 8
SCOPE_KEYS = ("user_id", "agent_id", "run_id")

STALE_ERROR = "A memory in this proposal was changed or deleted after the run."

# One run at a time; held from the request that starts a run until its background task ends.
run_lock = threading.Lock()

_JSON_RE = re.compile(r"\{.*\}", re.DOTALL)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _payload(row: Any) -> dict[str, Any]:
    return getattr(row, "payload", None) or {}


def scope_of(payload: dict[str, Any]) -> tuple:
    return tuple(payload.get(k) for k in SCOPE_KEYS)


def in_scope(payload: dict[str, Any], scope: dict[str, str]) -> bool:
    return all(payload.get(k) == v for k, v in scope.items())


def snapshot(row: Any) -> dict[str, Any]:
    payload = _payload(row)
    return {
        "id": str(row.id),
        "memory": payload.get("data"),
        "created_at": payload.get("created_at"),
        "categories": payload.get("categories") or [],
    }


def cluster(ids: list[str], pairs: Iterable[tuple[str, str]], max_size: int = MAX_CLUSTER_SIZE) -> list[list[str]]:
    """Group ids connected by similar pairs (union-find). Returns groups of 2+ ids, each in
    input order and capped at `max_size`; members past the cap wait for the next run."""
    parent = {i: i for i in ids}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for a, b in pairs:
        if a in parent and b in parent:
            parent[find(a)] = find(b)

    groups: dict[str, list[str]] = {}
    for i in ids:
        groups.setdefault(find(i), []).append(i)
    return [group[:max_size] for group in groups.values() if len(group) > 1]


def similar_pairs(rows: list[Any], threshold: float) -> list[tuple[str, str]]:
    """Pairs of rows in the same scope whose similarity score is at least `threshold`.

    Texts are embedded in one batch, then each vector is searched against the store,
    so the cost is one embedding call per 100 memories plus one query per memory."""
    memory = get_memory_instance()
    by_id = {str(row.id): row for row in rows}
    vectors = memory.embedding_model.embed_batch([_payload(row)["data"] for row in rows], "add")

    pairs = []
    for row, vector in zip(rows, vectors):
        payload = _payload(row)
        filters = {k: payload[k] for k in SCOPE_KEYS if payload.get(k)}
        hits = memory.vector_store.search(query=payload["data"], vectors=vector, top_k=NEIGHBORS, filters=filters)
        for hit in hits:
            hit_id = str(hit.id)
            neighbor = by_id.get(hit_id)
            if neighbor is None or hit_id == str(row.id) or (hit.score or 0) < threshold:
                continue
            # The store filter matches on the keys this row has; a neighbor with an extra key is another scope.
            if scope_of(_payload(neighbor)) == scope_of(payload):
                pairs.append((str(row.id), hit_id))
    return pairs


def build_prompt(memories: list[dict[str, Any]]) -> str:
    lines = "\n".join(
        f"[{i}] ({m.get('created_at') or 'unknown date'}) {m['memory']}" for i, m in enumerate(memories, 1)
    )
    return (
        "These memories about the same person or agent were flagged as similar, oldest first. "
        "Decide what to do with them.\n\n"
        f"{lines}\n\n"
        "Choose exactly one action:\n"
        '- "merge": two or more entries state the same fact. Write the single combined memory in `text`, '
        "keeping every detail and adding nothing new, and list the merged entries in `sources`.\n"
        '- "supersede": a newer entry contradicts or replaces older ones (a changed address, job or preference). '
        "Put the entry that is true now in `current` and the outdated ones in `outdated`.\n"
        '- "keep": the entries are related but distinct facts. When unsure, choose keep.\n\n'
        "`reason` is one short sentence for the person reviewing this. Describe the facts themselves; "
        "do not refer to entry numbers, which they never see.\n\n"
        "Answer with JSON only, in one of these forms:\n"
        '{"action": "merge", "text": "...", "sources": [1, 2], "reason": "..."}\n'
        '{"action": "supersede", "current": 2, "outdated": [1], "reason": "..."}\n'
        '{"action": "keep", "reason": "..."}'
    )


def _index(value: Any, count: int) -> Optional[int]:
    """1-based entry number from the LLM -> 0-based index, or None if out of range."""
    if isinstance(value, bool):
        return None
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number - 1 if 1 <= number <= count else None


def _indices(values: Any, count: int) -> list[int]:
    if not isinstance(values, list):
        return []
    picked: list[int] = []
    for value in values:
        index = _index(value, count)
        if index is not None and index not in picked:
            picked.append(index)
    return picked


def parse_decision(response: Any, count: int) -> Optional[dict[str, Any]]:
    """Validate an LLM reply for a group of `count` memories. Returns None for "keep" and
    for anything malformed, so a bad reply never turns into a destructive proposal."""
    if isinstance(response, dict):
        response = response.get("content") or ""
    match = _JSON_RE.search(str(response or ""))
    if not match:
        return None
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None

    action = str(data.get("action", "")).strip().lower()
    reason = str(data.get("reason") or "").strip()
    if action == "merge":
        sources = _indices(data.get("sources"), count)
        text = str(data.get("text") or "").strip()
        if len(sources) >= 2 and text:
            return {"kind": "merge", "sources": sorted(sources), "text": text, "reason": reason}
    elif action == "supersede":
        current = _index(data.get("current"), count)
        outdated = [i for i in _indices(data.get("outdated"), count) if i != current]
        if current is not None and outdated:
            return {"kind": "supersede", "current": current, "outdated": outdated, "reason": reason}
    return None


def decide(memories: list[dict[str, Any]]) -> Optional[dict[str, Any]]:
    response = get_memory_instance().llm.generate_response([{"role": "user", "content": build_prompt(memories)}])
    return parse_decision(response, len(memories))


def build_action(run_id: uuid.UUID, memories: list[dict[str, Any]], decision: dict[str, Any]) -> ConsolidationAction:
    """Turn a parsed decision on `memories` (oldest first) into a proposal row."""
    if decision["kind"] == "merge":
        involved = [memories[i] for i in decision["sources"]]
        target, removed = involved[0], involved[1:]
        new_text = decision["text"]
    else:
        target = memories[decision["current"]]
        removed = [memories[i] for i in decision["outdated"]]
        involved = [target, *removed]
        new_text = None
    return ConsolidationAction(
        run_id=run_id,
        kind=decision["kind"],
        status="proposed",
        target_id=target["id"],
        remove_ids=[m["id"] for m in removed],
        new_text=new_text,
        sources=involved,
        reason=decision["reason"],
    )


def _finish(run_id: uuid.UUID, **fields: Any) -> None:
    with SessionLocal() as db:
        run = db.get(ConsolidationRun, run_id)
        if run is None:
            return
        for key, value in fields.items():
            setattr(run, key, value)
        run.finished_at = _utcnow()
        db.commit()


def execute_run(run_id: uuid.UUID) -> None:
    """Background body of a run: scan, cluster, ask the LLM, store proposals. Releases run_lock."""
    try:
        with SessionLocal() as db:
            run = db.get(ConsolidationRun, run_id)
            scope, threshold = dict(run.scope or {}), run.threshold

        rows = [row for row in list_rows() if _payload(row).get("data") and in_scope(_payload(row), scope)]
        rows.sort(key=lambda row: str(_payload(row).get("created_at") or ""))
        rows = rows[-MAX_MEMORIES_PER_RUN:]
        by_id = {str(row.id): row for row in rows}

        groups = cluster(list(by_id), similar_pairs(rows, threshold)) if len(rows) > 1 else []
        actions = []
        for group in groups:
            memories = [snapshot(by_id[memory_id]) for memory_id in group]
            try:
                decision = decide(memories)
            except Exception:
                logging.exception("Consolidation LLM call failed for %s", group)
                continue
            if decision:
                actions.append(build_action(run_id, memories, decision))

        with SessionLocal() as db:
            db.add_all(actions)
            db.commit()
        _finish(run_id, status="completed", memories_scanned=len(rows), clusters_found=len(groups))
    except Exception as exc:
        logging.exception("Consolidation run %s failed", run_id)
        try:
            _finish(run_id, status="failed", error=str(exc) or type(exc).__name__)
        except Exception:
            logging.exception("Failed to record consolidation failure for %s", run_id)
    finally:
        run_lock.release()


def apply_action(action: ConsolidationAction) -> None:
    """Apply a proposed action in place, setting its status to applied, stale or failed.
    The caller owns the session and commits."""
    memory = get_memory_instance()
    try:
        for source in action.sources:
            row = memory.vector_store.get(vector_id=source["id"])
            if row is None or _payload(row).get("data") != source["memory"]:
                action.status, action.error = "stale", STALE_ERROR
                return
        if action.kind == "merge":
            memory.update(action.target_id, text=action.new_text)
            webhooks.emit("memory.updated", {"id": action.target_id, "data": action.new_text})
        for memory_id in action.remove_ids:
            memory.delete(memory_id=memory_id)
            webhooks.emit("memory.deleted", {"id": memory_id})
        action.status, action.error = "applied", None
    except Exception as exc:
        logging.exception("Failed to apply consolidation action %s", action.id)
        action.status, action.error = "failed", str(exc) or type(exc).__name__
    finally:
        action.resolved_at = _utcnow()
