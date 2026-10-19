"""REST routes for exact records (see exact_store.py). The MCP tools call the same store functions.

Keys contain "/", so record routes take the key as the rest of the path: /exact/records/server/hk1.
Values only ever travel in request and response bodies, never in the URL.
"""

from typing import Optional

import exact_store
import provenance
from auth import get_key_scope
from exact_store import BatchPut, RecordPut
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from scopes import KeyScope

router = APIRouter(prefix="/exact", tags=["exact"])

USER_HEADER = "X-Mem0-User-Id"


@router.get("/records", summary="Search or list exact records")
def search_records(
    q: Optional[str] = Query(None, description="Keywords. Without it, records are listed by key."),
    user_id: Optional[str] = None,
    kind: Optional[str] = None,
    tag: Optional[str] = None,
    prefix: Optional[str] = Query(None, description='Only keys starting with this, e.g. "server/".'),
    device: Optional[str] = Query(None, description="Only records last written from this device."),
    agent: Optional[str] = Query(None, description="Only records last written by this agent."),
    project: Optional[str] = Query(None, description="Only records of this project."),
    cwd: Optional[str] = Query(None, description="Only records written in this folder or one under it."),
    limit: int = Query(20, ge=1, le=exact_store.SEARCH_LIMIT),
    offset: int = Query(0, ge=0),
    x_user_id: Optional[str] = Header(None, alias=USER_HEADER),
    scope: Optional[KeyScope] = Depends(get_key_scope),
):
    uid = exact_store.resolve_user(scope, user_id or x_user_id, write=False)
    results = exact_store.search_records(
        uid,
        q,
        kind=kind,
        tag=tag,
        prefix=prefix,
        device=device,
        agent=agent,
        project=project,
        cwd=cwd,
        limit=limit,
        offset=offset,
    )
    return {"results": results}


@router.get("/records/{key:path}", summary="Get an exact record")
def get_record(
    key: str,
    user_id: Optional[str] = None,
    x_user_id: Optional[str] = Header(None, alias=USER_HEADER),
    scope: Optional[KeyScope] = Depends(get_key_scope),
):
    uid = exact_store.resolve_user(scope, user_id or x_user_id, write=False)
    record = exact_store.get_record(uid, key)
    if record is None:
        raise HTTPException(status_code=404, detail=f"No exact record {exact_store.normalize_key(key)}.")
    return record


@router.put("/records/{key:path}", summary="Create or update an exact record")
def put_record(
    key: str,
    body: RecordPut,
    request: Request,
    x_user_id: Optional[str] = Header(None, alias=USER_HEADER),
    scope: Optional[KeyScope] = Depends(get_key_scope),
):
    uid = exact_store.resolve_user(scope, body.user_id or x_user_id, write=True)
    record = exact_store.put_record(
        uid, key, body, merge=body.merge, if_version=body.if_version, source=provenance.from_request(request)
    )
    return JSONResponse(record, status_code=201 if record["result"] == "created" else 200)


@router.delete("/records/{key:path}", summary="Delete an exact record")
def delete_record(
    key: str,
    user_id: Optional[str] = None,
    x_user_id: Optional[str] = Header(None, alias=USER_HEADER),
    scope: Optional[KeyScope] = Depends(get_key_scope),
):
    uid = exact_store.resolve_user(scope, user_id or x_user_id, write=True)
    if not exact_store.delete_record(uid, key):
        raise HTTPException(status_code=404, detail=f"No exact record {exact_store.normalize_key(key)}.")
    return {"key": exact_store.normalize_key(key), "deleted": True}


@router.get("/history/{key:path}", summary="Earlier versions of an exact record")
def record_history(
    key: str,
    user_id: Optional[str] = None,
    limit: int = Query(20, ge=1, le=exact_store.HISTORY_LIMIT),
    x_user_id: Optional[str] = Header(None, alias=USER_HEADER),
    scope: Optional[KeyScope] = Depends(get_key_scope),
):
    uid = exact_store.resolve_user(scope, user_id or x_user_id, write=False)
    return exact_store.history(uid, key, limit=limit)


@router.post("/batch", summary="Create or update many exact records")
def put_batch(
    body: BatchPut,
    request: Request,
    x_user_id: Optional[str] = Header(None, alias=USER_HEADER),
    scope: Optional[KeyScope] = Depends(get_key_scope),
):
    """Up to 1000 records in one transaction, for imports (a password manager export, a server inventory).
    Each record's own project/cwd/device/agent wins over the X-Mem0-* headers."""
    uid = exact_store.resolve_user(scope, body.user_id or x_user_id, write=True)
    return exact_store.put_many(uid, body.records, merge=body.merge, source=provenance.from_request(request))
