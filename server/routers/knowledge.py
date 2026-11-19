from typing import Literal
from uuid import UUID

import knowledge
from auth import require_admin
from fastapi import APIRouter, BackgroundTasks, Depends, Query

router = APIRouter(prefix="/knowledge", tags=["knowledge"])


@router.post("/proposals", status_code=201)
def draft(body: knowledge.Draft, _admin=Depends(require_admin)):
    return knowledge.submit_draft(body)


@router.post("/preview")
def preview(body: knowledge.Preview, _admin=Depends(require_admin)):
    return knowledge.preview(body)


@router.get("/proposals")
def proposals(
    user_id: str,
    project: str | None = None,
    status: Literal["proposed", "applied", "dismissed"] = "proposed",
    limit: int = Query(30, ge=1, le=100),
    _admin=Depends(require_admin),
):
    return knowledge.list_proposals(user_id, project, status, limit)


@router.post("/proposals/{proposal_id}/review")
def review(proposal_id: UUID, body: knowledge.Review, tasks: BackgroundTasks, _admin=Depends(require_admin)):
    result = knowledge.review(proposal_id, body)
    if result.get("layer"):
        tasks.add_task(knowledge.index_revision, result)
    return result


@router.get("/proposals/{proposal_id}/current")
def current(proposal_id: UUID, _admin=Depends(require_admin)):
    return knowledge.current_for_proposal(proposal_id)


@router.get("/items/{item_id}/revisions")
def revisions(item_id: UUID, user_id: str, _admin=Depends(require_admin)):
    return knowledge.revisions(item_id, {"user_id": user_id})


@router.post("/items/{item_id}/restore")
def restore(
    item_id: UUID, user_id: str, body: knowledge.Restore, tasks: BackgroundTasks, _admin=Depends(require_admin)
):
    result = knowledge.restore(item_id, user_id, body)
    tasks.add_task(knowledge.index_revision, result)
    return result


@router.post("/tasks/{task_id}/close")
def close(task_id: str, user_id: str, project: str = "", _admin=Depends(require_admin)):
    return {"closed": knowledge.close_task(user_id, project, task_id)}
