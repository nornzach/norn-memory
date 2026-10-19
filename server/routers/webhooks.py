import uuid
from datetime import datetime
from typing import Literal, Optional

import webhooks
from auth import require_admin
from db import get_db
from fastapi import APIRouter, Depends, HTTPException
from models import Webhook
from pydantic import AnyHttpUrl, BaseModel, Field
from schemas import MessageResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

router = APIRouter(prefix="/webhooks", tags=["webhooks"])

WebhookEvent = Literal["memory.created", "memory.updated", "memory.deleted", "memories.deleted_all"]


class WebhookCreate(BaseModel):
    url: AnyHttpUrl
    events: list[WebhookEvent] = Field(..., min_length=1)


class WebhookUpdate(BaseModel):
    url: Optional[AnyHttpUrl] = None
    events: Optional[list[WebhookEvent]] = Field(None, min_length=1)
    is_active: Optional[bool] = None


class WebhookItem(BaseModel):
    id: uuid.UUID
    url: str
    events: list[str]
    is_active: bool
    secret_prefix: str
    created_at: datetime
    last_delivery_at: Optional[datetime] = None
    last_status_code: Optional[int] = None
    last_error: Optional[str] = None


class WebhookCreateResponse(WebhookItem):
    secret: str


class WebhookTestResponse(BaseModel):
    status_code: Optional[int] = None
    error: Optional[str] = None
    ok: bool


def _to_item(webhook: Webhook) -> dict:
    return {
        "id": webhook.id,
        "url": webhook.url,
        "events": webhook.events or [],
        "is_active": webhook.is_active,
        "secret_prefix": webhook.secret[:12],
        "created_at": webhook.created_at,
        "last_delivery_at": webhook.last_delivery_at,
        "last_status_code": webhook.last_status_code,
        "last_error": webhook.last_error,
    }


def _get_webhook(db: Session, webhook_id: str) -> Webhook:
    try:
        webhook = db.get(Webhook, uuid.UUID(webhook_id))
    except (TypeError, ValueError):
        webhook = None
    if webhook is None:
        raise HTTPException(status_code=404, detail="Webhook not found.")
    return webhook


@router.get("", response_model=list[WebhookItem])
def list_webhooks(_auth=Depends(require_admin), db: Session = Depends(get_db)):
    rows = db.execute(select(Webhook).order_by(Webhook.created_at.desc())).scalars().all()
    return [WebhookItem(**_to_item(w)) for w in rows]


@router.post("", response_model=WebhookCreateResponse, status_code=201)
def create_webhook(body: WebhookCreate, _auth=Depends(require_admin), db: Session = Depends(get_db)):
    webhook = Webhook(url=str(body.url), events=list(dict.fromkeys(body.events)), secret=webhooks.generate_secret())
    db.add(webhook)
    db.commit()
    db.refresh(webhook)
    return WebhookCreateResponse(**_to_item(webhook), secret=webhook.secret)


@router.patch("/{webhook_id}", response_model=WebhookItem)
def update_webhook(webhook_id: str, body: WebhookUpdate, _auth=Depends(require_admin), db: Session = Depends(get_db)):
    webhook = _get_webhook(db, webhook_id)
    if body.url is not None:
        webhook.url = str(body.url)
    if body.events is not None:
        webhook.events = list(dict.fromkeys(body.events))
    if body.is_active is not None:
        webhook.is_active = body.is_active
    db.commit()
    db.refresh(webhook)
    return WebhookItem(**_to_item(webhook))


@router.delete("/{webhook_id}", response_model=MessageResponse)
def delete_webhook(webhook_id: str, _auth=Depends(require_admin), db: Session = Depends(get_db)):
    db.delete(_get_webhook(db, webhook_id))
    db.commit()
    return MessageResponse(message="Webhook deleted.")


@router.post("/{webhook_id}/test", response_model=WebhookTestResponse)
def test_webhook(webhook_id: str, _auth=Depends(require_admin), db: Session = Depends(get_db)):
    """Send a signed `ping` event right away and report what the receiver answered."""
    webhook = _get_webhook(db, webhook_id)
    body = webhooks.build_body("ping", {"webhook_id": str(webhook.id)})
    status_code, error = webhooks.deliver(webhook.id, webhook.url, webhook.secret, "ping", body)
    return WebhookTestResponse(status_code=status_code, error=error, ok=error is None)
