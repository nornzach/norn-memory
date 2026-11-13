"""Memory hierarchy statistics for the dashboard pyramid view."""

import logging
from typing import Any, Optional

import exact_store
from auth import get_key_scope, verify_auth
from fastapi import APIRouter, Depends, HTTPException, Request
from memory_store import HIERARCHY_LAYERS, hierarchy_totals
from scopes import KeyScope

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/memories", tags=["hierarchy"])

LAYER_LABELS = {
    "L0": "Canonical",
    "L1": "Core",
    "L2": "Episodic",
    "L3": "Working",
    "L4": "Transient",
}


def _exact_count(ids: dict[str, str], scope: Optional[KeyScope]) -> Optional[int]:
    """Exact records are the real canonical layer. They're scoped by user_id only, so a key
    limited by anything else can't see them; counting is skipped rather than guessed."""
    if scope is not None and (scope.agent_ids or scope.run_ids or scope.categories):
        return None
    user_ids = list(scope.user_ids) if scope is not None and scope.user_ids else None
    if user_ids is None and ids.get("user_id"):
        user_ids = [ids["user_id"]]
    try:
        return exact_store.count_records(user_ids)
    except Exception:
        logger.exception("Counting exact records failed")
        return None


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
    key only sees the ids its limits allow. Legacy memories without layer fields count as L3.
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
        by_layer, contexts = hierarchy_totals(**ids, scope=scope)
    except Exception:
        logger.exception("Reading hierarchy totals failed")
        raise HTTPException(status_code=500, detail="Could not read memories.")

    total = sum(stats["count"] for stats in by_layer.values())
    total_importance = sum(stats["total_importance"] for stats in by_layer.values())
    return {
        "total_memories": total,
        "avg_importance": round(total_importance / total, 2) if total else 0.0,
        "by_layer": by_layer,
        "context_distribution": contexts,
        "exact_records": _exact_count(ids, scope),
        "pyramid": [
            {"layer": layer, "label": LAYER_LABELS[layer], "count": by_layer[layer]["count"]}
            for layer in HIERARCHY_LAYERS
        ],
    }
