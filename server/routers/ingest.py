"""Staged memory writes (see ingest.py): one job's outcome, and the queue for admins."""

import uuid
from datetime import datetime
from typing import Any, Optional

import ingest
from auth import get_key_scope, require_admin
from db import get_db
from fastapi import APIRouter, Depends, HTTPException, Query
from models import IngestJob
from pydantic import BaseModel, Field
from scopes import KeyScope
from sqlalchemy import select
from sqlalchemy.orm import Session

router = APIRouter(prefix="/ingest", tags=["ingest"])

LIST_LIMIT = 200


class JobItem(BaseModel):
    id: uuid.UUID
    status: str = Field(description="pending, processing, done or failed.")
    scope: dict[str, str] = Field(description="The user_id, agent_id and run_id the write was made for.")
    source: dict[str, Any] = Field(description="Where the write came from: agent, device, project, cwd, source.")
    preview: str = Field(description="The start of the first message.")
    attempts: int
    error: Optional[str]
    results: Optional[list[dict[str, Any]]] = Field(
        description="What happened to each fact once done: ADD, UPDATE, DELETE or NONE (already stored)."
    )
    created_at: datetime
    started_at: Optional[datetime]
    finished_at: Optional[datetime]


class JobDetail(JobItem):
    messages: list[dict[str, Any]]


class JobList(BaseModel):
    counts: dict[str, int] = Field(description="Jobs in the queue by status.")
    results: list[JobItem]


SOURCE_KEYS = ("agent", "device", "project", "cwd", "source")


def _job(job: IngestJob, cls=JobItem) -> Any:
    request = job.request or {}
    params = request.get("params") or {}
    metadata = params.get("metadata") or {}
    messages = request.get("messages") or []
    first = str((messages[0] or {}).get("content") or "") if messages else ""
    extra = {"messages": messages} if cls is JobDetail else {}
    return cls(
        id=job.id,
        status=job.status,
        scope=ingest.scope_of(params),
        source={k: metadata[k] for k in SOURCE_KEYS if metadata.get(k)},
        preview=first[:200],
        attempts=job.attempts,
        error=job.error,
        results=job.results,
        created_at=job.created_at,
        started_at=job.started_at,
        finished_at=job.finished_at,
        **extra,
    )


def _get_job(db: Session, job_id: str) -> IngestJob:
    try:
        job = db.get(IngestJob, uuid.UUID(job_id))
    except (TypeError, ValueError):
        job = None
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    return job


@router.get("/jobs/{job_id}", response_model=JobDetail)
def get_job(job_id: str, scope: Optional[KeyScope] = Depends(get_key_scope), db: Session = Depends(get_db)):
    """One staged write: its status and, once done, what happened to each fact."""
    job = _get_job(db, job_id)
    if scope is not None and not scope.allows(ingest.scope_of((job.request or {}).get("params") or {})):
        raise HTTPException(status_code=404, detail="Job not found.")
    return _job(job, JobDetail)


@router.get("/jobs", response_model=JobList)
def list_jobs(
    status: Optional[str] = Query(None, description="Only jobs with this status."),
    limit: int = Query(50, ge=1, le=LIST_LIMIT),
    _admin=Depends(require_admin),
    db: Session = Depends(get_db),
):
    """The newest staged writes, and how many jobs are in each status."""
    if status is not None and status not in ingest.STATUSES:
        raise HTTPException(status_code=422, detail=f"status must be one of: {', '.join(ingest.STATUSES)}")
    query = select(IngestJob).order_by(IngestJob.created_at.desc()).limit(limit)
    if status is not None:
        query = query.where(IngestJob.status == status)
    jobs = db.execute(query).scalars().all()
    return JobList(counts=ingest.counts(), results=[_job(job) for job in jobs])


@router.post("/jobs/{job_id}/retry", response_model=JobItem)
def retry_job(job_id: str, _admin=Depends(require_admin), db: Session = Depends(get_db)):
    """Queue a failed job again."""
    job = _get_job(db, job_id)
    if job.status != "failed":
        raise HTTPException(status_code=409, detail=f"Only failed jobs can be retried; this one is {job.status}.")
    ingest.retry(job)
    db.commit()
    db.refresh(job)
    ingest.worker.wake()
    return _job(job)
