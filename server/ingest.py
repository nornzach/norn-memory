"""Staged memory writes and the background worker that lands them.

POST /memories with infer does no LLM work while the caller waits: it checks the write, stages it as
an ingest job and answers 202. A worker thread in the server process takes jobs oldest first and runs
Memory.add with reconcile=True for each, so every extracted fact is compared with the stored memories
most like it and is added, skipped (already stored), merged into a stored memory, or stored in place of
outdated ones. The job keeps the outcome (the add results, or the error) for GET /ingest/jobs/{id}.

Jobs live in the app database, so a restart loses nothing. A job still running when the server shuts
down is handed back at once; one left behind by a process that died is taken again after LEASE. Re-running
a half-finished job is safe: reconcile skips the facts the first run already stored.

Each server process runs one worker, so one owner's writes land in the order they were made. More
processes share the queue safely (each job is claimed with SELECT ... FOR UPDATE SKIP LOCKED).
"""

import logging
import os
import threading
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import categorizer
import webhooks
from db import SessionLocal
from models import IngestJob
from server_state import get_memory_instance
from sqlalchemy import and_, delete, func, or_, select, update

from norn_m.exceptions import ValidationError as NornMValidationError

ASYNC_ENV = "NORN_M_ASYNC_ADD"
RECONCILE_ENV = "NORN_M_RECONCILE_ADD"
WORKER_ENV = "NORN_M_INGEST_WORKER"
RETENTION_ENV = "NORN_M_INGEST_RETENTION_DAYS"

STATUSES = ("pending", "processing", "done", "failed")
SCOPE_KEYS = ("user_id", "agent_id", "run_id")
MAX_ATTEMPTS = 3
RETRY_DELAYS = (timedelta(seconds=30), timedelta(minutes=2))  # before the 2nd and the 3rd attempt
LEASE = timedelta(minutes=10)
POLL_SECONDS = 30
PRUNE_EVERY = timedelta(hours=1)

logger = logging.getLogger(__name__)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _flag(name: str) -> bool:
    return os.environ.get(name, "true").strip().lower() not in {"0", "false", "no", "off"}


def async_enabled() -> bool:
    """Whether POST /memories with infer stages the write (default) or does all the work before answering."""
    return _flag(ASYNC_ENV)


def reconcile_enabled() -> bool:
    return _flag(RECONCILE_ENV)


def retention() -> timedelta:
    try:
        return timedelta(days=max(1, int(os.environ.get(RETENTION_ENV, "14"))))
    except ValueError:
        return timedelta(days=14)


def scope_of(params: dict[str, Any]) -> dict[str, Any]:
    return {k: params[k] for k in SCOPE_KEYS if params.get(k)}


# ---------------------------------------------------------------------------
# Running one write
# ---------------------------------------------------------------------------


def run_add(messages: list[dict], params: dict[str, Any], *, categorize: bool) -> tuple[dict, list[tuple[str, str]]]:
    """Memory.add for one write, reconciled when facts are inferred, then its webhooks.

    Returns the add response and the (id, text) pairs to tag with categories: the added and updated
    memories, unless the caller chose the categories itself (`categorize` False)."""
    reconcile = params.get("infer", True) is not False and reconcile_enabled()
    response = get_memory_instance().add(messages=messages, **params, reconcile=reconcile)
    results = response.get("results") or []
    webhooks.emit_memory_results(results, scope_of(params))
    to_tag = []
    if categorize:
        to_tag = [
            (r["id"], r["memory"])
            for r in results
            if r.get("event") in ("ADD", "UPDATE") and r.get("id") and r.get("memory")
        ]
    return response, to_tag


def run_job(request: dict[str, Any]) -> list[dict]:
    response, to_tag = run_add(request["messages"], request.get("params") or {}, categorize=request.get("categorize"))
    if to_tag:
        categorizer.categorize_memories(to_tag)  # already off the request path, so inline
    return response.get("results") or []


# ---------------------------------------------------------------------------
# The queue
# ---------------------------------------------------------------------------


def enqueue(messages: list[dict], params: dict[str, Any], *, categorize: bool) -> uuid.UUID:
    with SessionLocal() as db:
        job = IngestJob(
            status="pending",
            request={"messages": messages, "params": params, "categorize": categorize},
            attempts=0,
        )
        db.add(job)
        db.commit()
        job_id = job.id
    worker.wake()
    return job_id


def claim(now: Optional[datetime] = None) -> Optional[tuple[uuid.UUID, int, dict[str, Any]]]:
    """Take the oldest job that is due, or whose lease ran out. Returns (id, attempt, request) or None."""
    now = now or _utcnow()
    with SessionLocal() as db:
        job = (
            db.execute(
                select(IngestJob)
                .where(
                    or_(
                        and_(IngestJob.status == "pending", IngestJob.available_at <= now),
                        and_(IngestJob.status == "processing", IngestJob.started_at < now - LEASE),
                    )
                )
                .order_by(IngestJob.created_at)
                .limit(1)
                .with_for_update(skip_locked=True)
            )
            .scalars()
            .first()
        )
        if job is None:
            return None
        job.status, job.started_at, job.attempts = "processing", now, job.attempts + 1
        claimed = job.id, job.attempts, dict(job.request)
        db.commit()
        return claimed


def _settle(job_id: uuid.UUID, attempt: int, **fields: Any) -> bool:
    """Update a job this worker still holds. False when it was handed back or taken again meanwhile."""
    with SessionLocal() as db:
        result = db.execute(
            update(IngestJob)
            .where(IngestJob.id == job_id, IngestJob.status == "processing", IngestJob.attempts == attempt)
            .values(**fields)
        )
        db.commit()
        return result.rowcount == 1


def process(job_id: uuid.UUID, attempt: int, request: dict[str, Any]) -> None:
    try:
        results = run_job(request)
    except Exception as exc:
        error = str(exc) or type(exc).__name__
        now = _utcnow()
        # A write that fails validation fails the same way every time; anything else may be an outage.
        if isinstance(exc, (ValueError, NornMValidationError)) or attempt >= MAX_ATTEMPTS:
            logger.exception("Ingest job %s failed on attempt %d", job_id, attempt)
            _settle(job_id, attempt, status="failed", error=error, finished_at=now)
        else:
            delay = RETRY_DELAYS[min(attempt, len(RETRY_DELAYS)) - 1]
            logger.warning("Ingest job %s failed on attempt %d, retrying in %s: %s", job_id, attempt, delay, error)
            _settle(job_id, attempt, status="pending", error=error, available_at=now + delay)
        return
    _settle(job_id, attempt, status="done", results=results, error=None, finished_at=_utcnow())


def release(job_id: uuid.UUID, attempt: int) -> bool:
    """Hand a job back for the next worker, without counting the attempt (the server is stopping)."""
    return _settle(job_id, attempt, status="pending", attempts=attempt - 1, available_at=_utcnow())


def retry(job: IngestJob) -> None:
    """Queue a failed job again with fresh attempts. The caller owns the session and commits."""
    job.status, job.attempts, job.error, job.available_at = "pending", 0, None, _utcnow()
    job.started_at = job.finished_at = None


def prune(now: Optional[datetime] = None) -> int:
    """Delete finished jobs older than the retention period."""
    cutoff = (now or _utcnow()) - retention()
    with SessionLocal() as db:
        result = db.execute(
            delete(IngestJob).where(IngestJob.status.in_(("done", "failed")), IngestJob.finished_at < cutoff)
        )
        db.commit()
        return result.rowcount or 0


def counts() -> dict[str, int]:
    with SessionLocal() as db:
        rows = db.execute(select(IngestJob.status, func.count()).group_by(IngestJob.status)).all()
    found = {status: count for status, count in rows}
    return {status: found.get(status, 0) for status in STATUSES}


# ---------------------------------------------------------------------------
# The worker thread
# ---------------------------------------------------------------------------


class Worker:
    def __init__(self) -> None:
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()
        self._current: Optional[tuple[uuid.UUID, int]] = None
        self._pruned_at: Optional[datetime] = None

    def start(self) -> None:
        if not _flag(WORKER_ENV):
            logger.info("%s=false: this process does not run ingest jobs.", WORKER_ENV)
            return
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="norn-m-ingest", daemon=True)
        self._thread.start()

    def wake(self) -> None:
        self._wake.set()

    def stop(self, timeout: float = 3.0) -> None:
        """Stop taking jobs. A job still running is handed back so the next process takes it at once;
        if this one finishes it after all, the finished result is dropped and the rerun reconciles."""
        if self._thread is None:
            return
        self._stop.set()
        self._wake.set()
        self._thread.join(timeout)
        with self._lock:
            current = self._current
        if current is not None:
            try:
                release(*current)
            except Exception:
                logger.exception("Could not hand back ingest job %s", current[0])
        self._thread = None

    def _idle(self) -> None:
        self._wake.wait(POLL_SECONDS)
        self._wake.clear()

    def _prune_now_and_then(self) -> None:
        now = _utcnow()
        if self._pruned_at is None or now - self._pruned_at >= PRUNE_EVERY:
            self._pruned_at = now
            removed = prune(now)
            if removed:
                logger.info("Pruned %d finished ingest jobs", removed)

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                self._prune_now_and_then()
                claimed = claim()
            except Exception:
                logger.exception("Ingest worker could not read the job queue")
                self._idle()
                continue
            if claimed is None:
                self._idle()
                continue
            job_id, attempt, request = claimed
            with self._lock:
                self._current = (job_id, attempt)
            try:
                process(job_id, attempt, request)
            except Exception:
                logger.exception("Ingest job %s could not be settled", job_id)
            finally:
                with self._lock:
                    self._current = None


worker = Worker()
