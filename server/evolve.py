"""Hierarchy evolution: promote memories that keep proving useful, demote ones nobody touches.

Runs as a periodic tick inside the ingest worker (same process, same lifecycle). It walks the
store in small pages so a restart loses nothing — the next tick simply scans again.

Decisions come from norn_m.memory.hierarchy's should_promote / should_demote with the stored
access_count, last_accessed_at, importance and created_at as inputs, so the write path's layer
rule (assign_initial_layer) and this task's drift rule share one mapping module.

A "demote" below L4 means "expire": the memory gets an expiration date rather than a delete —
the transient TTL already decides when it disappears from listings and search.
"""

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Tuple

import memory_store
from norn_m.memory.hierarchy import MemoryLayer, should_demote, should_promote
from server_state import get_memory_instance

logger = logging.getLogger(__name__)

PAGE = int(os.environ.get("NORN_M_EVOLVE_PAGE", "500"))
MAX_PAGES = int(os.environ.get("NORN_M_EVOLVE_MAX_PAGES", "12"))  # one tick covers ~6k rows
TRANSIENT_DAYS = int(os.environ.get("NORN_M_TRANSIENT_TTL_DAYS", "30"))


def _iso_hours(ts: Any, now: datetime) -> float:
    """Hours between an ISO timestamp and now; unparseable or missing = 'very old'."""
    if not ts:
        return float("inf")
    try:
        moment = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        if moment.tzinfo is None:
            moment = moment.replace(tzinfo=timezone.utc)
        return max(0.0, (now - moment).total_seconds() / 3600)
    except (ValueError, TypeError):
        return float("inf")


def decide(payload: Dict[str, Any], now: datetime) -> Optional[Tuple[str, Dict[str, Any]]]:
    """What this row's layer should become, or None when it stays put.

    Returns ("layer", fields-to-merge). 'expire' folds into a layer change to L4 plus an
    expiration date so the row dies by the normal expiry rules instead of a hard delete.
    """
    layer = payload.get("layer")
    if layer == MemoryLayer.L0_CANONICAL.value:
        return None  # declared truths never move
    try:
        current = MemoryLayer(layer) if layer else MemoryLayer.L3_WORKING
    except ValueError:
        current = MemoryLayer.L3_WORKING

    try:
        access_count = int(payload.get("access_count") or 0)
    except (TypeError, ValueError):
        access_count = 0
    try:
        importance = float(payload.get("importance") or 5.0)
    except (TypeError, ValueError):
        importance = 5.0

    age_hours = _iso_hours(payload.get("created_at"), now)
    idle_hours = _iso_hours(payload.get("last_accessed_at") or payload.get("created_at"), now)

    promoted = should_promote(current, access_count, age_hours)
    if promoted is not None:
        return "layer", {"layer": promoted.value, "access_count": 0}

    demoted = should_demote(current, idle_hours, importance)
    if demoted is None:
        # archive rule: an ignored L4 just expires rather than being deleted outright
        expiry = (now + timedelta(days=TRANSIENT_DAYS)).date().isoformat()
        if not payload.get("expiration_date"):
            return "expire", {"expiration_date": expiry}
        return None
    if demoted != current:
        fields: Dict[str, Any] = {"layer": demoted.value}
        if demoted == MemoryLayer.L4_TRANSIENT and not payload.get("expiration_date"):
            fields["expiration_date"] = (now + timedelta(days=TRANSIENT_DAYS)).date().isoformat()
        return "layer", fields
    return None


def evolve_tick(now: Optional[datetime] = None) -> Dict[str, int]:
    """One evolution pass over the store. Returns counts, logged by the caller."""
    now = now or datetime.now(timezone.utc)
    store = get_memory_instance().vector_store
    db = get_memory_instance().db
    stats = {"scanned": 0, "promoted": 0, "demoted": 0, "expired": 0, "errors": 0}

    # ponytail: full id+payload scan per tick; cheap at thousands of rows, and a payload index on
    # the layer key is the upgrade path if the store grows an order of magnitude.
    rows = memory_store.list_rows()
    stats["scanned"] = len(rows)
    for row in rows[: PAGE * MAX_PAGES]:
        payload = dict(getattr(row, "payload", None) or {})
        if payload.get("expiration_date") and memory_store.is_expired(payload):
            continue  # already gone from views; leave it to the expiry rules
        change = decide(payload, now)
        if change is None:
            continue
        kind, fields = change
        try:
            store.update(vector_id=str(row.id), payload={**payload, **fields})
            if kind == "layer":
                direction = "promoted" if fields["layer"] < (payload.get("layer") or "L3") else "demoted"
                stats["promoted" if direction == "promoted" else "demoted"] += 1
            else:
                stats["expired"] += 1
            db.add_history(
                str(row.id),
                payload.get("data"),
                f'{payload.get("layer") or "L3"} -> {fields.get("layer", "L4-expire")}',
                "LAYER",
                created_at=payload.get("created_at"),
                updated_at=now.isoformat(),
                actor_id=payload.get("actor_id"),
                role=payload.get("role"),
            )
        except Exception:
            stats["errors"] += 1
            logger.warning("evolve: updating %s failed", getattr(row, "id", "?"), exc_info=True)
    return stats
