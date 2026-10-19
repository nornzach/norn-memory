import uuid
from collections import Counter
from datetime import datetime, timezone
from typing import Any, Optional

import categorizer
import consolidator
from auth import get_key_scope, require_admin_or_scoped
from db import get_db
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from models import ConsolidationAction, ConsolidationRun
from pydantic import BaseModel, Field
from schemas import MessageResponse
from scopes import KeyScope
from sqlalchemy import func, select
from sqlalchemy.orm import Session

router = APIRouter(prefix="/consolidation", tags=["consolidation"])


class RunCreate(BaseModel):
    user_id: Optional[str] = None
    agent_id: Optional[str] = None
    run_id: Optional[str] = None
    threshold: float = Field(
        consolidator.DEFAULT_THRESHOLD,
        ge=0.5,
        le=0.99,
        description="Minimum similarity for two memories to be compared.",
    )


class ActionItem(BaseModel):
    id: uuid.UUID
    run_id: uuid.UUID
    kind: str
    status: str
    target_id: str
    remove_ids: list[str]
    new_text: Optional[str]
    sources: list[dict[str, Any]]
    reason: str
    error: Optional[str]
    created_at: datetime
    resolved_at: Optional[datetime]

    model_config = {"from_attributes": True}


class RunItem(BaseModel):
    id: uuid.UUID
    status: str
    scope: dict[str, str]
    threshold: float
    memories_scanned: int
    clusters_found: int
    error: Optional[str]
    created_at: datetime
    finished_at: Optional[datetime]
    actions: dict[str, int] = Field(default_factory=dict, description="Number of proposals by status.")


class RunDetail(RunItem):
    proposals: list[ActionItem]


class ApplyAllResponse(BaseModel):
    applied: int
    stale: int
    failed: int


def _run_item(run: ConsolidationRun, counts: dict[str, int], cls=RunItem, **extra) -> Any:
    return cls(
        id=run.id,
        status=run.status,
        scope=run.scope or {},
        threshold=run.threshold,
        memories_scanned=run.memories_scanned,
        clusters_found=run.clusters_found,
        error=run.error,
        created_at=run.created_at,
        finished_at=run.finished_at,
        actions=counts,
        **extra,
    )


def _get(db: Session, model, object_id: str, label: str):
    try:
        obj = db.get(model, uuid.UUID(object_id))
    except (TypeError, ValueError):
        obj = None
    if obj is None:
        raise HTTPException(status_code=404, detail=f"{label} not found.")
    return obj


def _visible(run: ConsolidationRun, scope: Optional[KeyScope]) -> bool:
    """A scoped key sees a run only if the run's scope sits entirely inside the key's."""
    return scope is None or scope.covers(run.scope or {})


def _get_run(db: Session, run_id: str, scope: Optional[KeyScope]) -> ConsolidationRun:
    run = _get(db, ConsolidationRun, run_id, "Run")
    if not _visible(run, scope):
        raise HTTPException(status_code=404, detail="Run not found.")
    return run


def _get_proposed(db: Session, action_id: str, scope: Optional[KeyScope]) -> ConsolidationAction:
    if scope is not None:
        scope.require_write()
    action = _get(db, ConsolidationAction, action_id, "Proposal")
    if not _visible(db.get(ConsolidationRun, action.run_id), scope):
        raise HTTPException(status_code=404, detail="Proposal not found.")
    if action.status != "proposed":
        raise HTTPException(status_code=409, detail=f"Proposal is already {action.status}.")
    return action


def _recategorize(actions: list[ConsolidationAction], background_tasks: BackgroundTasks) -> None:
    items = [(a.target_id, a.new_text) for a in actions if a.status == "applied" and a.kind == "merge"]
    if items:
        background_tasks.add_task(categorizer.categorize_memories, items)


@router.post("/runs", response_model=RunItem, status_code=202)
def start_run(
    body: RunCreate,
    background_tasks: BackgroundTasks,
    _auth=Depends(require_admin_or_scoped),
    scope: Optional[KeyScope] = Depends(get_key_scope),
    db: Session = Depends(get_db),
):
    """Scan memories in the background and propose merges and supersedes. Changes nothing by itself."""
    if scope is not None:
        scope.require_write()
        if scope.categories:
            raise HTTPException(
                status_code=403,
                detail="Category-limited API keys cannot run consolidation: a run compares memories across categories.",
            )
        scope.check_ids(body.model_dump(include={"user_id", "agent_id", "run_id"}), required=True)
    if not consolidator.run_lock.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="A consolidation run is already in progress.")
    try:
        # Holding the lock means no run is executing, so any row still "running" was cut off by a restart.
        for orphan in db.execute(select(ConsolidationRun).where(ConsolidationRun.status == "running")).scalars():
            orphan.status, orphan.error = "failed", "Interrupted by a server restart."
        scope = {k: v for k, v in body.model_dump(include={"user_id", "agent_id", "run_id"}).items() if v}
        run = ConsolidationRun(status="running", scope=scope, threshold=body.threshold)
        db.add(run)
        db.commit()
        db.refresh(run)
    except Exception:
        consolidator.run_lock.release()
        raise
    background_tasks.add_task(consolidator.execute_run, run.id)
    return _run_item(run, {})


@router.get("/runs", response_model=list[RunItem])
def list_runs(
    limit: int = Query(20, ge=1, le=100),
    _auth=Depends(require_admin_or_scoped),
    scope: Optional[KeyScope] = Depends(get_key_scope),
    db: Session = Depends(get_db),
):
    runs = db.execute(select(ConsolidationRun).order_by(ConsolidationRun.created_at.desc()).limit(limit)).scalars()
    runs = [run for run in runs if _visible(run, scope)]
    counts: dict[uuid.UUID, Counter] = {run.id: Counter() for run in runs}
    if runs:
        rows = db.execute(
            select(ConsolidationAction.run_id, ConsolidationAction.status, func.count())
            .where(ConsolidationAction.run_id.in_(counts))
            .group_by(ConsolidationAction.run_id, ConsolidationAction.status)
        )
        for run_id, status, count in rows:
            counts[run_id][status] = count
    return [_run_item(run, dict(counts[run.id])) for run in runs]


@router.get("/runs/{run_id}", response_model=RunDetail)
def get_run(
    run_id: str,
    _auth=Depends(require_admin_or_scoped),
    scope: Optional[KeyScope] = Depends(get_key_scope),
    db: Session = Depends(get_db),
):
    run = _get_run(db, run_id, scope)
    actions = list(
        db.execute(
            select(ConsolidationAction)
            .where(ConsolidationAction.run_id == run.id)
            .order_by(ConsolidationAction.created_at, ConsolidationAction.id)
        ).scalars()
    )
    counts = dict(Counter(a.status for a in actions))
    return _run_item(run, counts, RunDetail, proposals=[ActionItem.model_validate(a) for a in actions])


@router.delete("/runs/{run_id}", response_model=MessageResponse)
def delete_run(
    run_id: str,
    _auth=Depends(require_admin_or_scoped),
    scope: Optional[KeyScope] = Depends(get_key_scope),
    db: Session = Depends(get_db),
):
    """Delete a run and its proposals. Memories already changed by applied proposals stay changed."""
    if scope is not None:
        scope.require_write()
    run = _get_run(db, run_id, scope)
    if run.status == "running":
        raise HTTPException(status_code=409, detail="Wait for the run to finish before deleting it.")
    db.delete(run)
    db.commit()
    return MessageResponse(message="Run deleted.")


@router.post("/runs/{run_id}/apply", response_model=ApplyAllResponse)
def apply_run(
    run_id: str,
    background_tasks: BackgroundTasks,
    _auth=Depends(require_admin_or_scoped),
    scope: Optional[KeyScope] = Depends(get_key_scope),
    db: Session = Depends(get_db),
):
    """Apply every proposal of a run that is still pending."""
    if scope is not None:
        scope.require_write()
    run = _get_run(db, run_id, scope)
    actions = list(
        db.execute(
            select(ConsolidationAction)
            .where(ConsolidationAction.run_id == run.id, ConsolidationAction.status == "proposed")
            .order_by(ConsolidationAction.created_at, ConsolidationAction.id)
        ).scalars()
    )
    for action in actions:
        consolidator.apply_action(action)
        db.commit()
    _recategorize(actions, background_tasks)
    counts = Counter(a.status for a in actions)
    return ApplyAllResponse(applied=counts["applied"], stale=counts["stale"], failed=counts["failed"])


@router.post("/proposals/{action_id}/apply", response_model=ActionItem)
def apply_proposal(
    action_id: str,
    background_tasks: BackgroundTasks,
    _auth=Depends(require_admin_or_scoped),
    scope: Optional[KeyScope] = Depends(get_key_scope),
    db: Session = Depends(get_db),
):
    action = _get_proposed(db, action_id, scope)
    consolidator.apply_action(action)
    db.commit()
    db.refresh(action)
    _recategorize([action], background_tasks)
    return ActionItem.model_validate(action)


@router.post("/proposals/{action_id}/dismiss", response_model=ActionItem)
def dismiss_proposal(
    action_id: str,
    _auth=Depends(require_admin_or_scoped),
    scope: Optional[KeyScope] = Depends(get_key_scope),
    db: Session = Depends(get_db),
):
    action = _get_proposed(db, action_id, scope)
    action.status = "dismissed"
    action.resolved_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(action)
    return ActionItem.model_validate(action)
