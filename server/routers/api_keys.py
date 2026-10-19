import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from auth import generate_api_key, require_auth
from db import get_db
from models import APIKey, User
from schemas import MessageResponse

router = APIRouter(prefix="/api-keys", tags=["api-keys"])


MAX_SCOPE_VALUES = 100
MAX_SCOPE_VALUE_LENGTH = 255
SCOPE_FIELDS = ("user_ids", "agent_ids", "run_ids", "categories")


class KeyScopes(BaseModel):
    access: Literal["read", "read_write"] = Field(
        "read_write", description="read: search and list only. read_write: also add, update and delete."
    )
    user_ids: list[str] = Field(default_factory=list, description="Only these user_id values. Empty: any.")
    agent_ids: list[str] = Field(default_factory=list, description="Only these agent_id values. Empty: any.")
    run_ids: list[str] = Field(default_factory=list, description="Only these run_id values. Empty: any.")
    categories: list[str] = Field(default_factory=list, description="Only memories tagged with one of these.")

    @field_validator(*SCOPE_FIELDS)
    @classmethod
    def _clean(cls, values: list[str]) -> list[str]:
        cleaned = list(dict.fromkeys(v.strip() for v in values if v and v.strip()))
        if len(cleaned) > MAX_SCOPE_VALUES:
            raise ValueError(f"at most {MAX_SCOPE_VALUES} values")
        if any(len(v) > MAX_SCOPE_VALUE_LENGTH for v in cleaned):
            raise ValueError(f"values must be at most {MAX_SCOPE_VALUE_LENGTH} characters")
        return cleaned


class CreateKeyRequest(KeyScopes):
    label: str


class CreateKeyResponse(KeyScopes):
    id: str
    key: str
    label: str
    key_prefix: str
    created_at: datetime


class KeyListItem(KeyScopes):
    id: str
    label: str
    key_prefix: str
    created_at: datetime
    last_used_at: datetime | None

    model_config = {"from_attributes": True}


def _scopes_of(key: APIKey) -> dict:
    return {"access": key.access or "read_write", **{f: getattr(key, f) or [] for f in SCOPE_FIELDS}}


@router.get("", response_model=list[KeyListItem])
def list_keys(user: User = Depends(require_auth), db: Session = Depends(get_db)):
    keys = (
        db.execute(
            select(APIKey)
            .where(APIKey.created_by == user.id, APIKey.revoked_at.is_(None))
            .order_by(APIKey.created_at.desc())
        )
        .scalars()
        .all()
    )
    return [
        KeyListItem(
            id=str(k.id),
            label=k.label,
            key_prefix=k.key_prefix,
            created_at=k.created_at,
            last_used_at=k.last_used_at,
            **_scopes_of(k),
        )
        for k in keys
    ]


@router.post("", response_model=CreateKeyResponse, status_code=201)
def create_key(body: CreateKeyRequest, user: User = Depends(require_auth), db: Session = Depends(get_db)):
    full_key, prefix, key_hash = generate_api_key()
    api_key = APIKey(
        key_prefix=prefix,
        key_hash=key_hash,
        label=body.label,
        created_by=user.id,
        access=body.access,
        **{f: getattr(body, f) or None for f in SCOPE_FIELDS},
    )
    db.add(api_key)
    db.commit()
    db.refresh(api_key)

    return CreateKeyResponse(
        id=str(api_key.id),
        key=full_key,
        label=api_key.label,
        key_prefix=prefix,
        created_at=api_key.created_at,
        **_scopes_of(api_key),
    )


@router.delete("/{key_id}", response_model=MessageResponse)
def revoke_key(key_id: str, user: User = Depends(require_auth), db: Session = Depends(get_db)):
    try:
        key_uuid = uuid.UUID(key_id)
    except (TypeError, ValueError):
        raise HTTPException(status_code=404, detail="API key not found.")
    api_key = db.get(APIKey, key_uuid)
    if api_key is None or api_key.created_by != user.id:
        raise HTTPException(status_code=404, detail="API key not found.")
    if api_key.revoked_at is not None:
        raise HTTPException(status_code=400, detail="API key is already revoked.")

    api_key.revoked_at = datetime.now(timezone.utc)
    db.commit()
    return MessageResponse(message="API key revoked.")
