from typing import Any, Optional

import secret_guard
import webhooks
from auth import require_admin
from errors import upstream_error
from fastapi import APIRouter, Depends, HTTPException
from memory_store import SCAN_LIMIT, list_memories
from pydantic import BaseModel, Field
from server_state import get_memory_instance

router = APIRouter(prefix="/import", tags=["import"])

MAX_IMPORT_BATCH = 100


class ImportedMemory(BaseModel):
    memory: str = Field(..., min_length=1, description="The memory text, stored as written (no LLM extraction).")
    user_id: Optional[str] = None
    agent_id: Optional[str] = None
    run_id: Optional[str] = None
    categories: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class ImportRequest(BaseModel):
    memories: list[ImportedMemory] = Field(..., max_length=MAX_IMPORT_BATCH)
    skip_duplicates: bool = Field(True, description="Skip a memory whose text already exists for the same owner.")


class ImportFailure(BaseModel):
    index: int
    error: str


class ImportResponse(BaseModel):
    imported: int
    skipped: int
    failed: list[ImportFailure]


def _owner(item: ImportedMemory) -> dict[str, str]:
    return {k: v for k, v in {"user_id": item.user_id, "agent_id": item.agent_id, "run_id": item.run_id}.items() if v}


@router.post("", response_model=ImportResponse, summary="Import memories from an export file")
def import_memories(body: ImportRequest, _auth=Depends(require_admin)):
    """Admin only. Takes the `memories` array of a JSON export, at most 100 per call. Each memory is
    stored verbatim (infer=false) with its owner, categories and metadata, so nothing is re-tagged."""
    try:
        existing = {(m["user_id"], m["agent_id"], m["run_id"], m["memory"]) for m in list_memories(SCAN_LIMIT)}
    except Exception:
        raise upstream_error()

    memory = get_memory_instance()
    imported = skipped = 0
    failed: list[ImportFailure] = []
    for index, item in enumerate(body.memories):
        owner = _owner(item)
        if not owner:
            failed.append(ImportFailure(index=index, error="Needs a user_id, agent_id or run_id."))
            continue
        text = item.memory.strip()
        key = (item.user_id, item.agent_id, item.run_id, text)
        if body.skip_duplicates and key in existing:
            skipped += 1
            continue
        metadata = {**item.metadata}
        if item.categories:
            metadata["categories"] = item.categories
        try:
            secret_guard.check({"memory": text, "metadata": metadata})
            response = memory.add(messages=[{"role": "user", "content": text}], infer=False, metadata=metadata, **owner)
        except HTTPException as e:
            failed.append(ImportFailure(index=index, error=str(e.detail)))
            continue
        except Exception as e:
            failed.append(ImportFailure(index=index, error=str(e) or "Could not store this memory."))
            continue
        existing.add(key)
        imported += 1
        webhooks.emit_memory_results(response.get("results") or [], owner)
    return ImportResponse(imported=imported, skipped=skipped, failed=failed)
