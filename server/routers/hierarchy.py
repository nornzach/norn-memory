"""Memory hierarchy statistics for the dashboard pyramid view."""

import logging
from typing import Any, Optional

from auth import get_key_scope, verify_auth
from fastapi import APIRouter, Depends, HTTPException, Request
from memory_store import list_memories
from scopes import KeyScope

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/memories", tags=["hierarchy"])

LAYERS = ("L0", "L1", "L2", "L3", "L4")
LAYER_LABELS = {
    "L0": "Canonical",
    "L1": "Core",
    "L2": "Episodic",
    "L3": "Working",
    "L4": "Transient",
}
# Memories written before hierarchy fields existed have neither; they are working memories at best.
DEFAULT_LAYER = "L3"
DEFAULT_IMPORTANCE = 5.0
DEFAULT_CONTEXT = "chat"


def _number(value: Any) -> float:
    """Importance as a float; payloads are JSON, so legacy rows may hold a string or nothing."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return DEFAULT_IMPORTANCE


def _layer(metadata: dict[str, Any]) -> str:
    value = metadata.get("layer")
    return value if value in LAYERS else DEFAULT_LAYER


@router.get("/hierarchy-stats")
def get_hierarchy_stats(
    request: Request,
    user_id: Optional[str] = None,
    agent_id: Optional[str] = None,
    run_id: Optional[str] = None,
    scope: Optional[KeyScope] = Depends(get_key_scope),
    auth: Any = Depends(verify_auth),
) -> dict[str, Any]:
    """Counts and average importance per memory layer, plus how memories split across contexts.

    Summarizing every owner at once is an admin view, exactly like listing all memories; a scoped
    key only sees the ids it allows.
    """
    ids = {k: v for k, v in {"user_id": user_id, "agent_id": agent_id, "run_id": run_id}.items() if v}
    if not ids:
        auth_type = getattr(request.state, "auth_type", "none")
        if (scope is None or not scope.restricts_entities) and getattr(auth, "role", None) != "admin" and auth_type not in {
            "admin_api_key",
            "disabled",
        }:
            raise HTTPException(status_code=403, detail="Admin role required to summarize all memories.")

    try:
        memories = list_memories(None, **ids, scope=scope)
    except Exception:
        logger.exception("Reading memories for hierarchy stats failed")
        raise HTTPException(status_code=500, detail="Could not read memories.")

    by_layer = {layer: {"count": 0, "total_importance": 0.0, "avg_importance": 0.0} for layer in LAYERS}
    contexts: dict[str, int] = {}
    for memory in memories:
        metadata = memory.get("metadata") or {}
        stats = by_layer[_layer(metadata)]
        stats["count"] += 1
        stats["total_importance"] += _number(metadata.get("importance"))
        context = metadata.get("context") or DEFAULT_CONTEXT
        contexts[context] = contexts.get(context, 0) + 1

    for stats in by_layer.values():
        if stats["count"]:
            stats["avg_importance"] = round(stats["total_importance"] / stats["count"], 2)

    total = len(memories)
    total_importance = sum(stats["total_importance"] for stats in by_layer.values())
    return {
        "total_memories": total,
        "avg_importance": round(total_importance / total, 2) if total else 0.0,
        "by_layer": by_layer,
        "context_distribution": dict(sorted(contexts.items(), key=lambda item: -item[1])),
        "pyramid": [
            {"layer": layer, "label": LAYER_LABELS[layer], "count": by_layer[layer]["count"]} for layer in LAYERS
        ],
    }
