"""Inspect retained curated inputs, or capture episodes only; never republish knowledge."""

import argparse
import json
from collections import Counter
from datetime import datetime, timezone

import episodes
import knowledge
from db import SessionLocal
from models import IngestJob
from sqlalchemy import select


def timestamp(value):
    result = datetime.fromisoformat(value)
    if result.tzinfo is None:
        raise argparse.ArgumentTypeError("Pass an ISO timestamp including its UTC offset.")
    return result


def run(db, user_id, start, end, memory=None):
    counts = Counter(retained_exchanges=0)
    jobs = select(IngestJob).where(
        IngestJob.created_at >= start, IngestJob.created_at < end, IngestJob.status == "done",
        IngestJob.request["params"]["user_id"].as_string() == user_id,
        IngestJob.request["params"]["knowledge_policy"].as_string() == "curated",
    ).order_by(IngestJob.created_at, IngestJob.id).execution_options(yield_per=50)
    for job in db.scalars(jobs):
        messages = job.request.get("messages")
        if not messages:
            continue
        counts["retained_exchanges"] += 1
        if memory is not None:
            params = job.request["params"]
            observed = job.created_at.replace(tzinfo=job.created_at.tzinfo or timezone.utc).isoformat()
            event, _ = episodes.capture(memory, messages, params, knowledge.namespace(params), str(job.id), observed)
            counts[event["event"] if event else "skipped"] += 1
    return counts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--user-id", required=True)
    parser.add_argument("--since", type=timestamp, required=True)
    parser.add_argument("--until", type=timestamp, required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if not args.since < args.until <= datetime.now(timezone.utc):
        parser.error("Choose a closed historical window: since < until <= now.")
    memory = None
    if args.apply:
        from main import get_memory_instance

        memory = get_memory_instance()
    with SessionLocal() as db:
        print(json.dumps(run(db, args.user_id, args.since, args.until, memory)))


if __name__ == "__main__":
    main()
