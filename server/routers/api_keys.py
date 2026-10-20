import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

import key_vault
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
    retrievable: bool = Field(False, description="Whether GET /api-keys/{id}/key can show the full key.")

    model_config = {"from_attributes": True}


class KeySecretResponse(BaseModel):
    id: str
    key: str


def _scopes_of(key: APIKey) -> dict:
    return {"access": key.access or "read_write", **{f: getattr(key, f) or [] for f in SCOPE_FIELDS}}


def _list_item(key: APIKey) -> KeyListItem:
    return KeyListItem(
        id=str(key.id),
        label=key.label,
        key_prefix=key.key_prefix,
        created_at=key.created_at,
        last_used_at=key.last_used_at,
        retrievable=key_vault.unseal(key.key_ciphertext) is not None,
        **_scopes_of(key),
    )


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
    return [_list_item(k) for k in keys]


@router.post("", response_model=CreateKeyResponse, status_code=201)
def create_key(body: CreateKeyRequest, user: User = Depends(require_auth), db: Session = Depends(get_db)):
    full_key, prefix, key_hash = generate_api_key()
    api_key = APIKey(
        key_prefix=prefix,
        key_hash=key_hash,
        key_ciphertext=key_vault.seal(full_key),
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


def _own_key(key_id: str, user: User, db: Session) -> APIKey:
    try:
        key_uuid = uuid.UUID(key_id)
    except (TypeError, ValueError):
        raise HTTPException(status_code=404, detail="API key not found.")
    api_key = db.get(APIKey, key_uuid)
    if api_key is None or api_key.created_by != user.id:
        raise HTTPException(status_code=404, detail="API key not found.")
    return api_key


class UpdateKeyRequest(KeyScopes):
    label: str = Field(..., min_length=1, max_length=255)


@router.put("/{key_id}", response_model=KeyListItem)
def update_key(key_id: str, body: UpdateKeyRequest, user: User = Depends(require_auth), db: Session = Depends(get_db)):
    """Rename a key or change its access and scope. The secret itself never changes."""
    api_key = _own_key(key_id, user, db)
    if api_key.revoked_at is not None:
        raise HTTPException(status_code=400, detail="API key is revoked.")
    api_key.label = body.label.strip()
    api_key.access = body.access
    for field in SCOPE_FIELDS:
        setattr(api_key, field, getattr(body, field) or None)
    db.commit()
    db.refresh(api_key)
    return _list_item(api_key)


@router.get("/{key_id}/key", response_model=KeySecretResponse)
def get_key(key_id: str, user: User = Depends(require_auth), db: Session = Depends(get_db)):
    """The full key, for the user who created it, so it can be copied into another agent."""
    api_key = _own_key(key_id, user, db)
    if api_key.revoked_at is not None:
        raise HTTPException(status_code=400, detail="API key is revoked.")
    full_key = key_vault.unseal(api_key.key_ciphertext)
    if full_key is None:
        raise HTTPException(
            status_code=409,
            detail=(
                "This key can't be shown again: it was created before keys were kept, or the server's "
                "JWT_SECRET has changed since. It still works. Create a new key if you need to copy one."
            ),
        )
    return KeySecretResponse(id=str(api_key.id), key=full_key)


@router.delete("/{key_id}", response_model=MessageResponse)
def revoke_key(key_id: str, user: User = Depends(require_auth), db: Session = Depends(get_db)):
    api_key = _own_key(key_id, user, db)
    if api_key.revoked_at is not None:
        raise HTTPException(status_code=400, detail="API key is already revoked.")

    api_key.revoked_at = datetime.now(timezone.utc)
    db.commit()
    return MessageResponse(message="API key revoked.")
