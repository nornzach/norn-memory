"""Distill existing fuzzy memories into reviewed knowledge without rewriting the source rows.

The command is deliberately opt-in: without ``--apply`` it only runs extraction and prints a preview.
Each applied candidate is staged through the same automatic review path as a live exchange, so an
incomplete or conflicting candidate is dismissed rather than overwriting current knowledge.
"""

import argparse
import json
import logging
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Any, Iterable
from uuid import UUID

import knowledge
import memory_store
import secret_guard

logger = logging.getLogger(__name__)
DEFAULT_BATCH_SIZE = 16
DEFAULT_MAX_CONTENT = 1200
DEFAULT_LAYERS = ("L1", "L2")


def parse_timestamp(value: str) -> datetime:
    try:
        result = datetime.fromisoformat(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError(f"Invalid ISO timestamp: {value}") from error
    if result.tzinfo is None:
        raise argparse.ArgumentTypeError("Timestamps must include a timezone offset.")
    return result.astimezone(timezone.utc)


def _created_at(row: dict[str, Any]) -> datetime:
    value = row.get("created_at") or row.get("updated_at")
    if not value:
        return datetime.min.replace(tzinfo=timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return datetime.min.replace(tzinfo=timezone.utc)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _project(row: dict[str, Any]) -> str:
    metadata = row.get("metadata") or {}
    return str(metadata.get("project") or "").strip().lower()


def _layer(row: dict[str, Any]) -> str:
    return str((row.get("metadata") or {}).get("layer") or "L3")


def _source(row: dict[str, Any]) -> dict[str, Any]:
    metadata = row.get("metadata") or {}
    observed_at = _created_at(row)
    return {
        "memory_id": str(row["id"]),
        "message": 1,
        "role": str(row.get("role") or metadata.get("role") or "assistant"),
        "observed_at": observed_at.isoformat(),
        "fingerprint": knowledge._digest(
            {"memory_id": str(row["id"]), "hash": row.get("hash"), "memory": row.get("memory")}
        ),
        "job_id": None,
    }


def eligible_rows(
    rows: Iterable[Any],
    *,
    user_id: str,
    since: datetime | None,
    until: datetime | None,
    projects: set[str] | None,
    layers: set[str],
    deduplicate: bool = True,
) -> list[dict[str, Any]]:
    """Normalize, filter and deterministically deduplicate legacy vector rows."""
    found: list[dict[str, Any]] = []
    for raw in rows:
        payload = getattr(raw, "payload", None) or {}
        row = memory_store.serialize_memory(raw)
        row["role"] = payload.get("role")
        if row.get("user_id") != user_id or not row.get("memory"):
            continue
        if payload.get("record_kind") == "episode":
            continue
        if _layer(row) not in layers:
            continue
        created_at = _created_at(row)
        if since and created_at < since:
            continue
        if until and created_at >= until:
            continue
        if projects is not None and _project(row) not in projects:
            continue
        if secret_guard.find_secrets(str(row["memory"])):
            continue
        found.append(row)

    found.sort(key=lambda row: (_project(row), _created_at(row), str(row["id"])))
    if not deduplicate:
        return found
    unique: dict[tuple[str, str], dict[str, Any]] = {}
    for row in found:
        key = (_project(row), str(row.get("hash") or row["memory"]))
        unique.setdefault(key, row)
    return list(unique.values())


def batches(rows: list[dict[str, Any]], size: int) -> Iterable[tuple[str, list[dict[str, Any]]]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[_project(row)].append(row)
    for project in sorted(grouped):
        project_rows = grouped[project]
        for offset in range(0, len(project_rows), size):
            yield project, project_rows[offset : offset + size]


def _messages(rows: list[dict[str, Any]], max_content: int) -> list[dict[str, str]]:
    return [
        {
            "role": str(row.get("role") or "assistant"),
            "content": str(row["memory"])[:max_content],
        }
        for row in rows
    ]


def distill_batch(
    rows: list[dict[str, Any]],
    *,
    user_id: str,
    project: str,
    apply: bool,
    max_content: int,
) -> Counter:
    messages = _messages(rows, max_content)
    scope = knowledge.namespace({"user_id": user_id, "metadata": {"project": project}})
    candidates = knowledge.extract(messages, scope, None)
    counts = Counter(candidates=len(candidates))
    if not apply:
        return counts
    for candidate in candidates:
        sources = []
        for reference in sorted(set(candidate.evidence_refs)):
            source = _source(rows[reference - 1])
            source["message"] = reference
            sources.append(source)
        event = knowledge.stage(candidate, scope, sources)
        counts[event["event"].lower()] += 1
        if event["status"] == "proposed":
            status = knowledge.resolve_exchange(UUID(event["id"]))
            counts[status] += 1
    return counts


def run(args: argparse.Namespace) -> Counter:
    rows = eligible_rows(
        memory_store.list_rows(),
        user_id=args.user_id,
        since=args.since,
        until=args.until,
        projects=set(args.project) if args.project else None,
        layers=set(args.layer or DEFAULT_LAYERS),
        deduplicate=not args.keep_duplicates,
    )
    if args.limit is not None:
        rows = rows[: args.limit]
    totals = Counter(selected=len(rows), skipped_secret=0)
    for batch_number, (project, chunk) in enumerate(batches(rows, args.batch_size), 1):
        if args.max_batches is not None and batch_number > args.max_batches:
            break
        for attempt in range(1, args.retries + 1):
            try:
                result = distill_batch(
                    chunk,
                    user_id=args.user_id,
                    project=project,
                    apply=args.apply,
                    max_content=args.max_content,
                )
                totals.update(result)
                totals["batches"] += 1
                print(
                    json.dumps(
                        {
                            "batch": batch_number,
                            "project": project or "(general)",
                            "source_count": len(chunk),
                            **result,
                        },
                        ensure_ascii=False,
                    ),
                    flush=True,
                )
                break
            except Exception:
                if attempt == args.retries:
                    totals["errors"] += 1
                    logger.exception("Distillation batch %d failed", batch_number)
                    if not args.continue_on_error:
                        raise
                else:
                    time.sleep(args.retry_delay * attempt)
    return totals


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--user-id", required=True)
    result.add_argument("--since", type=parse_timestamp)
    result.add_argument("--until", type=parse_timestamp)
    result.add_argument("--project", action="append", help="Repeat to limit to selected projects.")
    result.add_argument("--layer", action="append", choices=("L0", "L1", "L2", "L3", "L4"))
    result.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    result.add_argument("--limit", type=int)
    result.add_argument("--max-batches", type=int)
    result.add_argument("--max-content", type=int, default=DEFAULT_MAX_CONTENT)
    result.add_argument("--retries", type=int, default=3)
    result.add_argument("--retry-delay", type=float, default=3)
    result.add_argument("--keep-duplicates", action="store_true")
    result.add_argument("--continue-on-error", action="store_true")
    result.add_argument("--apply", action="store_true", help="Stage and automatically resolve candidates.")
    return result


def main() -> int:
    args = parser().parse_args()
    if args.batch_size < 1 or args.limit is not None and args.limit < 1:
        parser().error("batch size and limit must be positive")
    if args.max_content < 1 or args.retries < 1:
        parser().error("max content and retries must be positive")
    if args.since and args.until and args.since >= args.until:
        parser().error("since must be earlier than until")
    if args.until and args.until > datetime.now(timezone.utc):
        parser().error("until cannot be in the future")
    if not args.apply:
        logger.warning("Preview mode: no proposals or knowledge items will be written.")
    totals = run(args)
    print(json.dumps({"totals": totals}, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
