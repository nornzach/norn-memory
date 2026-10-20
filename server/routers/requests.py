import uuid
from datetime import datetime

from auth import require_admin
from db import get_db
from fastapi import APIRouter, Depends, Query
from models import RequestLog
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

router = APIRouter(prefix="/requests", tags=["requests"])


class RequestLogItem(BaseModel):
    id: uuid.UUID
    method: str
    path: str
    status_code: int
    latency_ms: float
    auth_type: str
    key_label: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


API_KEY_AUTH_TYPES = ("api_key", "admin_api_key")


@router.get("", response_model=list[RequestLogItem])
def list_requests(
    _auth=Depends(require_admin),
    db: Session = Depends(get_db),
    limit: int = Query(default=50, ge=1, le=200),
    key: str | None = Query(default=None, description="Only calls made with the API key of this label."),
):
    query = select(RequestLog).where(RequestLog.auth_type.in_(API_KEY_AUTH_TYPES))
    if key:
        query = query.where(RequestLog.key_label == key)
    logs = db.execute(query.order_by(RequestLog.created_at.desc()).limit(limit)).scalars().all()
    return logs
