import re
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

from auth import require_admin
from db import get_db
from fastapi import APIRouter, Depends, Query
from memory_store import iter_payloads
from models import RequestLog
from pydantic import BaseModel
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from routers.requests import API_KEY_AUTH_TYPES

router = APIRouter(prefix="/analytics", tags=["analytics"])

Range = Literal["24h", "7d", "30d"]
RANGES: dict[str, tuple[timedelta, str]] = {
    "24h": (timedelta(hours=24), "hour"),
    "7d": (timedelta(days=7), "day"),
    "30d": (timedelta(days=30), "day"),
}
# Path segments that are ids (uuids, numbers, long tokens) collapse to {id} so
# /memories/<a> and /memories/<b> count as one endpoint.
_ID_SEGMENT = re.compile(r"^(?:[0-9a-fA-F-]{16,}|\d+|[A-Za-z0-9_-]{24,})$")


class Totals(BaseModel):
    requests: int
    errors: int
    success_rate: Optional[float] = None
    avg_latency_ms: Optional[float] = None
    p95_latency_ms: Optional[float] = None


class SeriesPoint(BaseModel):
    bucket: datetime
    requests: int
    errors: int


class EndpointStat(BaseModel):
    method: str
    path: str
    requests: int
    errors: int
    avg_latency_ms: float


class CategoryStat(BaseModel):
    name: str
    memories: int


class AnalyticsResponse(BaseModel):
    range: Range
    granularity: Literal["hour", "day"]
    totals: Totals
    series: list[SeriesPoint]
    endpoints: list[EndpointStat]
    total_memories: int
    categories: list[CategoryStat]


# Routes whose last path parameter is an exact-record key, which may itself contain "/".
_KEY_ROUTES = ("/exact/records/", "/exact/history/")


def normalize_path(path: str) -> str:
    for route in _KEY_ROUTES:
        if path.startswith(route) and len(path) > len(route):
            return route + "{key}"
    return "/".join("{id}" if _ID_SEGMENT.match(part) else part for part in path.split("/"))


def _bucket_start(moment: datetime, granularity: str) -> datetime:
    moment = moment.astimezone(timezone.utc)
    if granularity == "hour":
        return moment.replace(minute=0, second=0, microsecond=0)
    return moment.replace(hour=0, minute=0, second=0, microsecond=0)


@router.get("", response_model=AnalyticsResponse)
def get_analytics(
    range_: Range = Query("7d", alias="range"),
    _auth=Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Usage of the memory API by API-key callers (dashboard traffic is excluded, as on the Requests page)."""
    window, granularity = RANGES[range_]
    now = datetime.now(timezone.utc)
    since = now - window
    is_error = case((RequestLog.status_code >= 400, 1), else_=0)
    scoped = (RequestLog.created_at >= since, RequestLog.auth_type.in_(API_KEY_AUTH_TYPES))

    count, errors, avg_latency, p95_latency = db.execute(
        select(
            func.count(RequestLog.id),
            func.coalesce(func.sum(is_error), 0),
            func.avg(RequestLog.latency_ms),
            func.percentile_cont(0.95).within_group(RequestLog.latency_ms),
        ).where(*scoped)
    ).one()
    totals = Totals(
        requests=count,
        errors=errors,
        success_rate=round((count - errors) / count * 100, 2) if count else None,
        avg_latency_ms=round(avg_latency, 1) if avg_latency is not None else None,
        p95_latency_ms=round(p95_latency, 1) if p95_latency is not None else None,
    )

    bucket = func.date_trunc(granularity, RequestLog.created_at).label("bucket")
    by_bucket = {
        _bucket_start(row.bucket, granularity): row
        for row in db.execute(
            select(bucket, func.count(RequestLog.id).label("requests"), func.sum(is_error).label("errors"))
            .where(*scoped)
            .group_by(bucket)
        )
    }
    step = timedelta(hours=1) if granularity == "hour" else timedelta(days=1)
    series = []
    cursor = _bucket_start(since, granularity)
    while cursor <= now:
        row = by_bucket.get(cursor)
        series.append(SeriesPoint(bucket=cursor, requests=row.requests if row else 0, errors=row.errors if row else 0))
        cursor += step

    merged: dict[tuple[str, str], dict[str, float]] = {}
    for row in db.execute(
        select(
            RequestLog.method,
            RequestLog.path,
            func.count(RequestLog.id).label("requests"),
            func.sum(is_error).label("errors"),
            func.sum(RequestLog.latency_ms).label("latency_total"),
        )
        .where(*scoped)
        .group_by(RequestLog.method, RequestLog.path)
    ):
        stat = merged.setdefault((row.method, normalize_path(row.path)), {"requests": 0, "errors": 0, "latency": 0.0})
        stat["requests"] += row.requests
        stat["errors"] += row.errors
        stat["latency"] += row.latency_total
    endpoints = sorted(
        (
            EndpointStat(
                method=method,
                path=path,
                requests=int(s["requests"]),
                errors=int(s["errors"]),
                avg_latency_ms=round(s["latency"] / s["requests"], 1),
            )
            for (method, path), s in merged.items()
        ),
        key=lambda e: e.requests,
        reverse=True,
    )

    payloads = iter_payloads()
    category_counts: Counter = Counter()
    for payload in payloads:
        category_counts.update(payload.get("categories") or [])

    return AnalyticsResponse(
        range=range_,
        granularity=granularity,
        totals=totals,
        series=series,
        endpoints=endpoints,
        total_memories=len(payloads),
        categories=[CategoryStat(name=name, memories=n) for name, n in category_counts.most_common()],
    )
