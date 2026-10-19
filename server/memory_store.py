"""Helpers for reading and patching raw memory rows in the vector store.

Shared by main.py and the routers so none of them has to import main.
"""

from typing import Any, Dict, Iterable, Mapping, Optional

import provenance
from server_state import get_memory_instance

ALL_MEMORIES_LIMIT = 1000
SCAN_LIMIT = 10_000
RESERVED_PAYLOAD_KEYS = {
    "data",
    "user_id",
    "agent_id",
    "run_id",
    "hash",
    "created_at",
    "updated_at",
    "expiration_date",
    "categories",
    "text_lemmatized",
}


def serialize_memory(row: Any) -> Dict[str, Any]:
    payload = getattr(row, "payload", None) or {}
    return {
        "id": getattr(row, "id", None),
        "memory": payload.get("data"),
        "user_id": payload.get("user_id"),
        "agent_id": payload.get("agent_id"),
        "run_id": payload.get("run_id"),
        "hash": payload.get("hash"),
        "expiration_date": payload.get("expiration_date"),
        "categories": payload.get("categories") or [],
        "metadata": {k: v for k, v in payload.items() if k not in RESERVED_PAYLOAD_KEYS},
        "created_at": payload.get("created_at"),
        "updated_at": payload.get("updated_at"),
    }


def list_rows(limit: int = SCAN_LIMIT) -> list[Any]:
    results = get_memory_instance().vector_store.list(top_k=limit)
    return results[0] if results and isinstance(results, list) and isinstance(results[0], list) else results or []


def list_memories(
    limit: int = ALL_MEMORIES_LIMIT,
    *,
    user_id: Optional[str] = None,
    agent_id: Optional[str] = None,
    run_id: Optional[str] = None,
    category: Optional[str] = None,
    source: Optional[Mapping[str, str]] = None,
) -> list[Dict[str, Any]]:
    """Serialized memories, optionally filtered. Filters are applied after the scan, so
    `limit` caps how many rows are scanned when any filter is set. `source` takes
    provenance.query_filters() (device, agent, project, folder)."""
    filtered = any([user_id, agent_id, run_id, category, source])
    memories = [serialize_memory(row) for row in list_rows(SCAN_LIMIT if filtered else limit)]
    if user_id:
        memories = [m for m in memories if m["user_id"] == user_id]
    if agent_id:
        memories = [m for m in memories if m["agent_id"] == agent_id]
    if run_id:
        memories = [m for m in memories if m["run_id"] == run_id]
    if category:
        memories = [m for m in memories if category in m["categories"]]
    if source:
        matches = provenance.matcher(source)
        memories = [m for m in memories if matches(m)]
    return memories[:limit]


def iter_payloads() -> list[Dict[str, Any]]:
    return [getattr(row, "payload", None) or {} for row in list_rows()]


def patch_payload(memory_id: str, updates: Dict[str, Any], remove: Iterable[str] = ()) -> bool:
    """Merge `updates` into a memory's payload (and drop the `remove` keys) without
    re-embedding it. Returns False if the memory no longer exists."""
    vector_store = get_memory_instance().vector_store
    row = vector_store.get(vector_id=memory_id)
    if row is None:
        return False
    payload = dict(getattr(row, "payload", None) or {})
    payload.update(updates)
    for key in remove:
        payload.pop(key, None)
    vector_store.update(vector_id=memory_id, payload=payload)
    return True
