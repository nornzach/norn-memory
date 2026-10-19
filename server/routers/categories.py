import threading
import uuid
from collections import Counter
from datetime import datetime
from typing import Optional

from auth import require_admin
from categorizer import categorize_memories
from db import get_db
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from memory_store import iter_payloads, list_rows, patch_payload
from models import Category
from pydantic import BaseModel, Field
from schemas import MessageResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

router = APIRouter(prefix="/categories", tags=["categories"])

BACKFILL_LIMIT = 500
_backfill_lock = threading.Lock()


class CategoryCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    description: str = Field("", max_length=2000)


class CategoryUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=64)
    description: Optional[str] = Field(None, max_length=2000)


class CategoryItem(BaseModel):
    id: uuid.UUID
    name: str
    description: str
    memory_count: int
    created_at: datetime


class BackfillResponse(BaseModel):
    queued: int
    message: str


def _category_counts() -> Counter:
    counts: Counter = Counter()
    for payload in iter_payloads():
        counts.update(payload.get("categories") or [])
    return counts


def _get_category(db: Session, category_id: str) -> Category:
    try:
        category = db.get(Category, uuid.UUID(category_id))
    except (TypeError, ValueError):
        category = None
    if category is None:
        raise HTTPException(status_code=404, detail="Category not found.")
    return category


def _ensure_unique(db: Session, name: str, exclude_id: Optional[uuid.UUID] = None) -> None:
    existing = db.execute(select(Category).where(Category.name.ilike(name))).scalars().first()
    if existing is not None and existing.id != exclude_id:
        raise HTTPException(status_code=409, detail=f"Category '{name}' already exists.")


def _rewrite_tagged(old_name: str, new_name: Optional[str]) -> None:
    """Rename (or, with new_name=None, remove) a category on every memory tagged with it.

    A memory left with no categories goes back to untagged, so the next backfill
    re-evaluates it against the remaining categories."""
    for row in list_rows():
        payload = getattr(row, "payload", None) or {}
        categories = payload.get("categories") or []
        if old_name not in categories:
            continue
        updated = list(dict.fromkeys(new_name if c == old_name else c for c in categories if new_name or c != old_name))
        if updated:
            patch_payload(str(row.id), {"categories": updated})
        else:
            patch_payload(str(row.id), {}, remove=("categories",))


def _to_item(category: Category, counts: Counter) -> CategoryItem:
    return CategoryItem(
        id=category.id,
        name=category.name,
        description=category.description,
        memory_count=counts.get(category.name, 0),
        created_at=category.created_at,
    )


@router.get("", response_model=list[CategoryItem])
def list_categories(_auth=Depends(require_admin), db: Session = Depends(get_db)):
    categories = db.execute(select(Category).order_by(Category.name)).scalars().all()
    counts = _category_counts()
    return [_to_item(c, counts) for c in categories]


@router.post("", response_model=CategoryItem, status_code=201)
def create_category(body: CategoryCreate, _auth=Depends(require_admin), db: Session = Depends(get_db)):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Category name is required.")
    _ensure_unique(db, name)
    category = Category(name=name, description=body.description.strip())
    db.add(category)
    db.commit()
    db.refresh(category)
    return _to_item(category, Counter())


@router.patch("/{category_id}", response_model=CategoryItem)
def update_category(
    category_id: str, body: CategoryUpdate, _auth=Depends(require_admin), db: Session = Depends(get_db)
):
    category = _get_category(db, category_id)
    old_name = category.name
    if body.name is not None and body.name.strip() != old_name:
        new_name = body.name.strip()
        _ensure_unique(db, new_name, exclude_id=category.id)
        category.name = new_name
    if body.description is not None:
        category.description = body.description.strip()
    db.commit()
    if category.name != old_name:
        _rewrite_tagged(old_name, category.name)
    return _to_item(category, _category_counts())


@router.delete("/{category_id}", response_model=MessageResponse)
def delete_category(category_id: str, _auth=Depends(require_admin), db: Session = Depends(get_db)):
    category = _get_category(db, category_id)
    name = category.name
    db.delete(category)
    db.commit()
    _rewrite_tagged(name, None)
    return MessageResponse(message="Category deleted.")


def _run_backfill(items: list[tuple[str, str]]) -> None:
    try:
        categorize_memories(items)
    finally:
        _backfill_lock.release()


@router.post("/backfill", response_model=BackfillResponse)
def backfill_categories(
    background_tasks: BackgroundTasks,
    retag_all: bool = Query(False, description="Re-tag every memory, not only untagged ones."),
    _auth=Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Tag existing memories in the background. Memories already tagged (even with no
    matching category) are skipped unless `retag_all` is set."""
    if db.execute(select(Category.id).limit(1)).first() is None:
        raise HTTPException(status_code=400, detail="Create at least one category first.")
    if not _backfill_lock.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="A tagging run is already in progress.")

    items = []
    for row in list_rows():
        payload = getattr(row, "payload", None) or {}
        if payload.get("data") and (retag_all or "categories" not in payload):
            items.append((str(row.id), payload["data"]))
    items = items[:BACKFILL_LIMIT]
    if not items:
        _backfill_lock.release()
        return BackfillResponse(queued=0, message="Every memory is already tagged.")

    background_tasks.add_task(_run_backfill, items)
    return BackfillResponse(queued=len(items), message=f"Tagging {len(items)} memories in the background.")
