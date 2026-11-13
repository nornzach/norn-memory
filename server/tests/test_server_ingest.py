"""Staged writes: the ingest queue, worker and endpoints."""

from contextlib import ExitStack
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import ingest
import pytest
from db import Base, get_db
from fastapi import FastAPI
from fastapi.testclient import TestClient
from models import IngestJob
from routers.ingest import router
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

SCOPE = {"user_id": "zach", "agent_id": None, "run_id": None}


@pytest.fixture
def db_engine():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine, tables=[IngestJob.__table__])
    return engine


@pytest.fixture
def session_factory(db_engine):
    return sessionmaker(bind=db_engine)


@pytest.fixture
def client(db_engine):
    def _db():
        db = sessionmaker(bind=db_engine)()
        try:
            yield db
        finally:
            db.close()

    app = FastAPI()
    app.include_router(router)
    from auth import require_admin, verify_auth

    app.dependency_overrides[verify_auth] = lambda: None
    app.dependency_overrides[require_admin] = lambda: None
    app.dependency_overrides[get_db] = _db
    with TestClient(app) as c:
        yield c


def _utcnow():
    return datetime.now(timezone.utc)


def _request(messages, **params):
    return {"messages": messages, "params": params, "categorize": True}


# ---------------------------------------------------------------------------
# Queue mechanics
# ---------------------------------------------------------------------------


def test_enqueue_stages_a_write_and_returns_its_id(session_factory):
    with ExitStack() as stack:
        stack.enter_context(patch.object(ingest, "SessionLocal", session_factory))
        stack.enter_context(patch.object(ingest.worker, "wake"))
        job_id = ingest.enqueue([{"role": "user", "content": "memo"}], {"user_id": "zach"}, categorize=True)

    db = session_factory()
    job = db.get(IngestJob, job_id)
    assert job.status == "pending" and job.request["params"]["user_id"] == "zach"
    db.close()


def test_claim_takes_the_oldest_pending_and_marks_it_processing(session_factory):
    db = session_factory()
    now = _utcnow()
    db.add_all(
        [
            IngestJob(
                status="pending",
                request=_request([{"content": "memo"}]),
                created_at=now - timedelta(seconds=i),
                available_at=now - timedelta(seconds=i),
            )
            for i in (3, 2, 1)
        ]
    )
    db.commit()
    ids = [j.id for j in db.query(IngestJob).order_by(IngestJob.created_at.desc()).all()]
    db.close()

    with patch.object(ingest, "SessionLocal", session_factory):
        job_id, attempt, request = ingest.claim(now)

    db = session_factory()
    claimed = db.get(IngestJob, job_id)
    assert job_id == ids[2] and attempt == 1 and claimed.status == "processing" and claimed.started_at.replace(tzinfo=timezone.utc) == now
    db.close()


def test_claim_reclaims_a_job_whose_lease_ran_out(session_factory):
    db = session_factory()
    now = _utcnow()
    db.add(
        IngestJob(
            status="processing",
            request=_request([{"content": "stuck"}]),
            started_at=now - ingest.LEASE - timedelta(seconds=1),
            attempts=1,
        )
    )
    db.commit()
    job_id = db.query(IngestJob).first().id
    db.close()

    with patch.object(ingest, "SessionLocal", session_factory):
        claimed_id, attempt, _ = ingest.claim(now)

    assert claimed_id == job_id and attempt == 2


def test_claim_returns_none_when_the_queue_is_empty(session_factory):
    with patch.object(ingest, "SessionLocal", session_factory):
        assert ingest.claim() is None


def test_settle_updates_a_job_this_worker_still_holds(session_factory):
    db = session_factory()
    job = IngestJob(status="processing", request=_request([{"content": "memo"}]), attempts=1)
    db.add(job)
    db.commit()
    job_id = job.id
    db.close()

    with patch.object(ingest, "SessionLocal", session_factory):
        updated = ingest._settle(job_id, 1, status="done", results=[{"event": "ADD"}], finished_at=_utcnow())

    assert updated is True
    db = session_factory()
    job = db.get(IngestJob, job_id)
    assert job.status == "done" and job.results == [{"event": "ADD"}]
    db.close()


def test_settle_fails_when_the_job_was_taken_again(session_factory):
    db = session_factory()
    job = IngestJob(status="processing", request=_request([{"content": "memo"}]), attempts=2)
    db.add(job)
    db.commit()
    job_id = job.id
    db.close()

    with patch.object(ingest, "SessionLocal", session_factory):
        updated = ingest._settle(job_id, 1, status="done", results=[])

    assert updated is False


def test_release_hands_a_job_back_without_counting_the_attempt(session_factory):
    db = session_factory()
    job = IngestJob(status="processing", request=_request([{"content": "memo"}]), attempts=2)
    db.add(job)
    db.commit()
    job_id = job.id
    db.close()

    with patch.object(ingest, "SessionLocal", session_factory):
        released = ingest.release(job_id, 2)

    assert released is True
    db = session_factory()
    job = db.get(IngestJob, job_id)
    assert job.status == "pending" and job.attempts == 1
    db.close()


def test_retry_resets_a_failed_job(session_factory):
    db = session_factory()
    job = IngestJob(
        status="failed",
        request=_request([{"content": "memo"}]),
        attempts=3,
        error="store down",
        finished_at=_utcnow(),
    )
    db.add(job)
    db.commit()

    ingest.retry(job)
    db.commit()
    db.refresh(job)
    assert job.status == "pending" and job.attempts == 0 and job.error is None and job.finished_at is None
    db.close()


def test_prune_deletes_finished_jobs_past_retention(session_factory):
    db = session_factory()
    now = _utcnow()
    cutoff = now - ingest.retention()
    db.add_all(
        [
            IngestJob(status="done", request=_request([{"content": "old"}]), finished_at=cutoff - timedelta(seconds=1)),
            IngestJob(status="failed", request=_request([{"content": "old"}]), finished_at=cutoff - timedelta(hours=1)),
            IngestJob(status="done", request=_request([{"content": "new"}]), finished_at=cutoff + timedelta(seconds=1)),
            IngestJob(status="pending", request=_request([{"content": "pending"}])),
        ]
    )
    db.commit()
    db.close()

    with patch.object(ingest, "SessionLocal", session_factory):
        removed = ingest.prune(now)

    assert removed == 2
    db = session_factory()
    assert db.query(IngestJob).count() == 2
    db.close()


def test_counts_groups_jobs_by_status(session_factory):
    db = session_factory()
    db.add_all(
        [
            IngestJob(status="pending", request=_request([{"content": "a"}])),
            IngestJob(status="pending", request=_request([{"content": "b"}])),
            IngestJob(status="processing", request=_request([{"content": "c"}])),
            IngestJob(status="done", request=_request([{"content": "d"}])),
        ]
    )
    db.commit()
    db.close()

    with patch.object(ingest, "SessionLocal", session_factory):
        found = ingest.counts()

    assert found == {"pending": 2, "processing": 1, "done": 1, "failed": 0}


# ---------------------------------------------------------------------------
# The worker
# ---------------------------------------------------------------------------


def test_worker_processes_a_job_and_settles_it_as_done(session_factory):
    memory = MagicMock()
    memory.add.return_value = {"results": [{"id": "m1", "memory": "memo", "event": "ADD"}]}
    db = session_factory()
    now = _utcnow()
    job = IngestJob(
        status="processing",
        request=_request([{"role": "user", "content": "memo"}], user_id="zach"),
        attempts=1,
        started_at=now,
    )
    db.add(job)
    db.commit()
    job_id = job.id
    db.close()

    with ExitStack() as stack:
        stack.enter_context(patch.object(ingest, "SessionLocal", session_factory))
        stack.enter_context(patch.object(ingest, "get_memory_instance", return_value=memory))
        stack.enter_context(patch("ingest.categorizer.categorize_memories"))
        stack.enter_context(patch("ingest.webhooks.emit_memory_results"))
        ingest.process(job_id, 1, job.request)

    db = session_factory()
    job = db.get(IngestJob, job_id)
    assert job.status == "done" and job.results == [{"id": "m1", "memory": "memo", "event": "ADD"}]
    assert job.error is None and job.finished_at.replace(tzinfo=timezone.utc) >= now
    db.close()


def test_worker_retries_a_failed_job_with_a_delay(session_factory):
    memory = MagicMock()
    memory.add.side_effect = RuntimeError("store down")
    db = session_factory()
    now = _utcnow()
    job = IngestJob(
        status="processing", request=_request([{"role": "user", "content": "memo"}]), attempts=1, started_at=now
    )
    db.add(job)
    db.commit()
    job_id = job.id
    db.close()

    with ExitStack() as stack:
        stack.enter_context(patch.object(ingest, "SessionLocal", session_factory))
        stack.enter_context(patch.object(ingest, "get_memory_instance", return_value=memory))
        ingest.process(job_id, 1, job.request)

    db = session_factory()
    job = db.get(IngestJob, job_id)
    assert job.status == "pending" and job.error == "store down"
    assert job.available_at.replace(tzinfo=timezone.utc) >= now + ingest.RETRY_DELAYS[0]
    db.close()


def test_worker_fails_a_job_that_raises_validation_error(session_factory):
    from norn_m.exceptions import ValidationError

    memory = MagicMock()
    memory.add.side_effect = ValidationError("bad scope", "VAL_001")
    db = session_factory()
    attempt = 1
    job = IngestJob(status="processing", request=_request([{"content": "memo"}]), attempts=attempt)
    db.add(job)
    db.commit()
    job_id = job.id
    db.close()

    with ExitStack() as stack:
        stack.enter_context(patch.object(ingest, "SessionLocal", session_factory))
        stack.enter_context(patch.object(ingest, "get_memory_instance", return_value=memory))
        ingest.process(job_id, attempt, job.request)

    db = session_factory()
    job = db.get(IngestJob, job_id)
    assert job.status == "failed" and "bad scope" in job.error
    db.close()


def test_worker_fails_a_job_after_max_attempts(session_factory):
    memory = MagicMock()
    memory.add.side_effect = RuntimeError("store down")
    db = session_factory()
    job = IngestJob(status="processing", request=_request([{"content": "memo"}]), attempts=ingest.MAX_ATTEMPTS)
    db.add(job)
    db.commit()
    job_id = job.id
    db.close()

    with ExitStack() as stack:
        stack.enter_context(patch.object(ingest, "SessionLocal", session_factory))
        stack.enter_context(patch.object(ingest, "get_memory_instance", return_value=memory))
        ingest.process(job_id, ingest.MAX_ATTEMPTS, job.request)

    db = session_factory()
    job = db.get(IngestJob, job_id)
    assert job.status == "failed"
    db.close()


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


def test_get_job_returns_its_status_and_results(client, db_engine):
    db = sessionmaker(bind=db_engine)()
    job = IngestJob(
        status="done",
        request=_request([{"role": "user", "content": "I moved to Berlin"}], user_id="zach", metadata={"agent": "cli"}),
        results=[{"id": "m1", "memory": "Lives in Berlin", "event": "ADD"}],
        finished_at=_utcnow(),
    )
    db.add(job)
    db.commit()
    job_id = job.id
    db.close()

    resp = client.get(f"/ingest/jobs/{job_id}")

    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "done" and data["scope"] == {"user_id": "zach"}
    assert data["source"]["agent"] == "cli" and "Berlin" in data["preview"]
    assert data["results"] == [{"id": "m1", "memory": "Lives in Berlin", "event": "ADD"}]


def test_get_job_hides_jobs_from_other_scopes(client, db_engine):
    from auth import get_key_scope
    from scopes import KeyScope

    db = sessionmaker(bind=db_engine)()
    job = IngestJob(status="pending", request=_request([{"content": "memo"}], user_id="alice"))
    db.add(job)
    db.commit()
    job_id = job.id
    db.close()

    client.app.dependency_overrides[get_key_scope] = lambda: KeyScope(user_ids={"zach"})
    resp = client.get(f"/ingest/jobs/{job_id}")

    assert resp.status_code == 404


def test_list_jobs_returns_counts_and_newest_jobs(client, db_engine):
    session_factory = sessionmaker(bind=db_engine)
    db = session_factory()
    now = _utcnow()
    db.add_all(
        [
            IngestJob(status="done", request=_request([{"content": "a"}]), created_at=now - timedelta(seconds=i), available_at=now, finished_at=now)
            for i in range(3)
        ]
        + [IngestJob(status="pending", request=_request([{"content": "b"}]), available_at=now)]
    )
    db.commit()
    db.close()

    with patch.object(ingest, "SessionLocal", session_factory):
        resp = client.get("/ingest/jobs?limit=2")

        assert resp.status_code == 200
        data = resp.json()
        assert data["counts"] == {"pending": 1, "processing": 0, "done": 3, "failed": 0}
        assert len(data["results"]) == 2


def test_retry_queues_a_failed_job_again(client, db_engine):
    db = sessionmaker(bind=db_engine)()
    job = IngestJob(status="failed", request=_request([{"content": "memo"}]), error="store down", attempts=3)
    db.add(job)
    db.commit()
    job_id = job.id
    db.close()

    with patch.object(ingest.worker, "wake"):
        resp = client.post(f"/ingest/jobs/{job_id}/retry")

    assert resp.status_code == 200
    db = sessionmaker(bind=db_engine)()
    job = db.get(IngestJob, job_id)
    assert job.status == "pending" and job.attempts == 0
    db.close()


def test_retry_rejects_a_non_failed_job(client, db_engine):
    db = sessionmaker(bind=db_engine)()
    job = IngestJob(status="pending", request=_request([{"content": "memo"}]))
    db.add(job)
    db.commit()
    job_id = job.id
    db.close()

    resp = client.post(f"/ingest/jobs/{job_id}/retry")

    assert resp.status_code == 409
