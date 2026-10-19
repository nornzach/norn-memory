import csv
import io
import json
from datetime import datetime, timezone
from typing import Any, Literal, Optional

import provenance
from auth import get_key_scope, require_admin_or_scoped
from errors import upstream_error
from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from memory_store import SCAN_LIMIT, list_memories
from scopes import KeyScope

router = APIRouter(prefix="/export", tags=["export"])

CSV_COLUMNS = [
    "id",
    "memory",
    "user_id",
    "agent_id",
    "run_id",
    "categories",
    *provenance.STAMPED,
    "metadata",
    "created_at",
    "updated_at",
]


def to_csv(memories: list[dict[str, Any]]) -> str:
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=CSV_COLUMNS, extrasaction="ignore")
    writer.writeheader()
    for memory in memories:
        writer.writerow(
            {
                **{field: (memory.get("metadata") or {}).get(field) for field in provenance.STAMPED},
                **memory,
                "categories": ";".join(memory.get("categories") or []),
                "metadata": json.dumps(memory.get("metadata") or {}, default=str),
            }
        )
    return buffer.getvalue()


def to_json(memories: list[dict[str, Any]], filters: dict[str, str]) -> str:
    return json.dumps(
        {
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "filters": filters,
            "total": len(memories),
            "memories": memories,
        },
        indent=2,
        default=str,
    )


@router.get("", summary="Export memories as JSON or CSV")
def export_memories(
    format: Literal["json", "csv"] = Query("json"),
    user_id: Optional[str] = None,
    agent_id: Optional[str] = None,
    run_id: Optional[str] = None,
    category: Optional[str] = None,
    device: Optional[str] = None,
    agent: Optional[str] = None,
    project: Optional[str] = None,
    cwd: Optional[str] = Query(None, description="This folder and everything under it."),
    _auth=Depends(require_admin_or_scoped),
    scope: Optional[KeyScope] = Depends(get_key_scope),
):
    """Admin only. A scoped key of an admin exports only the memories inside its scope."""
    filters = {
        k: v for k, v in {"user_id": user_id, "agent_id": agent_id, "run_id": run_id, "category": category}.items() if v
    }
    if scope is not None:
        scope.check_ids(filters)
    source = provenance.query_filters(device=device, agent=agent, project=project, cwd=cwd)
    try:
        memories = list_memories(SCAN_LIMIT, **filters, source=source)
    except Exception:
        raise upstream_error()
    if scope is not None:
        memories = scope.filter(memories)

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    if format == "csv":
        content, media_type = to_csv(memories), "text/csv"
    else:
        content, media_type = to_json(memories, {**filters, **source}), "application/json"
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="norn-m-memories-{stamp}.{format}"'},
    )
