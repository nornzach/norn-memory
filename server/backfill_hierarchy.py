"""Backfill layer/importance/context on memories written before the hierarchy fields existed.

Run inside the API container (the image already has norn_m installed and the env):

    docker compose -f docker-compose.prod.yaml exec norn-m python /app/backfill_hierarchy.py

Flags (env): BACKFILL_BATCH (default 24, memories per LLM call), BACKFILL_LIMIT (0 = all),
BACKFILL_DRY=1 prints what would be written without touching the store.

The LLM only rates importance 1-10; the layer is derived with assign_initial_layer, the same
mapping new writes use, and context comes from infer_context, so the backfill can only produce
values the write path itself would. Idempotent: rows that already carry a layer are skipped.
"""

import json
import logging
import os
import sys
from typing import Any, Dict, List

import memory_store
from main import DEFAULT_CONFIG
from norn_m.memory.context import infer_context
from norn_m.memory.hierarchy import assign_initial_layer, validate_importance
from server_state import get_memory_instance, initialize_state

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

BATCH = int(os.environ.get("BACKFILL_BATCH", "24"))
LIMIT = int(os.environ.get("BACKFILL_LIMIT", "0"))
DRY = os.environ.get("BACKFILL_DRY") == "1"

PROMPT = """Rate each memory's importance on a 1-10 scale for a long-term personal assistant.

10  lasting truth or core identity (name, family, permanent constraints, principles)
 8  stable preference, skill, or important long-term fact
 5  an event or detail worth remembering for weeks
 2  a transient state, one-off task detail, or noise

Memories (JSON lines: index, memory):
{items}

Reply with ONLY a JSON array like [{{"i": 0, "s": 8}}, {{"i": 1, "s": 3}}] — one object per memory,
i = the memory's index, s = its importance."""


def _pending_rows(limit: int) -> List[Any]:
    """Rows whose payload lacks the hierarchy layer, capped by `limit` (0 = all)."""
    rows = [row for row in memory_store.list_rows() if not (getattr(row, "payload", None) or {}).get("layer")]
    return rows[:limit] if limit else rows


def _score_batch(rows: List[Any], llm: Any) -> Dict[int, float]:
    items = "\n".join(
        f"{i}. {json.dumps(str((row.payload or {}).get('data') or '')[:400], ensure_ascii=False)}"
        for i, row in enumerate(rows)
    )
    reply = llm.generate_response(
        messages=[
            {"role": "system", "content": "You rate how much each memory matters long-term. Output JSON only."},
            {"role": "user", "content": PROMPT.format(items=items)},
        ],
        response_format={"type": "json_object"},
    )
    if isinstance(reply, dict):
        reply = json.dumps(reply)
    start, end = reply.find("["), reply.rfind("]")
    scored = json.loads(reply[start : end + 1]) if start != -1 and end > start else []
    # Index-keyed answers: a batch is only as good as the scores it actually returned.
    # Missing or malformed entries leave their rows pending for the next run.
    out: Dict[int, float] = {}
    for item in scored:
        try:
            index, score = int(item["i"]), validate_importance(float(item["s"]))
        except (KeyError, TypeError, ValueError):
            continue
        if 0 <= index < len(rows):
            out[index] = score
    return out


def main() -> int:
    rows = _pending_rows(LIMIT)
    logger.info("backfill: %d memories need hierarchy fields (dry=%s)", len(rows), DRY)
    if not rows:
        return 0

    initialize_state(DEFAULT_CONFIG)  # idempotent; the app does the same on boot
    memory = get_memory_instance()
    store = memory.vector_store
    llm = memory.llm

    done = failed = 0
    for offset in range(0, len(rows), BATCH):
        batch = rows[offset : offset + BATCH]
        try:
            scores = _score_batch(batch, llm)
        except Exception as e:
            # Skip instead of writing defaults: those rows stay pending so a re-run retries them,
            # and stats keep treating them like every other legacy memory (L3/5.0).
            logger.warning("backfill: batch at %d failed (%s); skipped, retry on the next run", offset, e)
            failed += len(batch)
            continue
        if not scores:
            logger.warning("backfill: batch at %d returned no usable scores; skipped", offset)
            failed += len(batch)
            continue

        for index, row in enumerate(batch):
            score = scores.get(index)
            if score is None:
                failed += 1
                continue
            payload = dict(row.payload or {})
            payload["importance"] = score
            payload["layer"] = assign_initial_layer(score).value
            payload["last_accessed_at"] = payload.get("created_at")
            if "context" not in payload:
                payload["context"] = infer_context(payload, payload.get("agent_id"), payload.get("run_id"))
            if DRY:
                done += 1
                continue
            try:
                store.update(vector_id=str(row.id), payload=payload)
                done += 1
            except Exception as e:
                failed += 1
                logger.warning("backfill: updating %s failed: %s", row.id, e)
        logger.info("backfill: %d/%d done", min(offset + BATCH, len(rows)), len(rows))

    logger.info("backfill finished: %d %s, %d failed", done, "dry-runs" if DRY else "updated", failed)
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
