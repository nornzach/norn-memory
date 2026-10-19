"""Exact records: typed key -> fields entries that are stored and returned verbatim.

Fuzzy memory sends text through an LLM (fact extraction, categorization, consolidation) and the
embedder, which may rewrite or drop details. Exact records never leave Postgres: they are written as
given, fetched by key, and searched by keyword (substring and trigram matching), so the same query
always returns the same records in the same order. Values, passwords included, are stored in
plaintext. Every update and delete keeps the previous state in exact_record_versions.
"""

import json
import math
import re
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Mapping, Optional, Tuple

import provenance
from db import SessionLocal
from fastapi import HTTPException
from models import ExactRecord, ExactRecordVersion
from pydantic import BaseModel, Field, field_validator
from scopes import KeyScope
from sqlalchemy import case, func, literal, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

MAX_KEY_LENGTH = 255
MAX_TAGS = 50
MAX_TAG_LENGTH = 64
MAX_FIELDS = 200
MAX_FIELD_NAME_LENGTH = 64
MAX_DESCRIPTION_LENGTH = 200_000
MAX_RECORD_BYTES = 512 * 1024
SEARCH_LIMIT = 200
BATCH_LIMIT = 1000
HISTORY_LIMIT = 100
MAX_QUERY_TERMS = 12
# Minimum word similarity (pg_trgm, 0-1) for a typo-tolerant match when no term matches as a substring.
TRIGRAM_THRESHOLD = 0.5
DEFAULT_KIND = "note"
SUGGESTED_KINDS = ("credential", "account", "server", "api_key", "url", "person", "date", "address", "note")
KIND_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,31}$")

_CJK = "぀-ヿ㐀-䶿一-鿿가-힯豈-﫿"
# CJK runs, or runs of anything but whitespace, CJK and sentence punctuation. Dots, dashes, slashes,
# colons and @ stay inside a term, so IPs, hostnames, URLs and emails are matched whole.
_TERM_RE = re.compile(rf"[{_CJK}]+|[^\s{_CJK},;!?()\[\]{{}}\"'`“”‘’，。；：！？（）、《》【】]+")
_STOPWORDS = frozenset(
    "a an and are as at be by can do does for from has have how i in is it me my of on or our please "
    "show tell that the their this to us was what whats when where which who why with you your".split()
)
_CJK_STOPWORDS = frozenset(
    ["我的", "你的", "他的", "她的", "什么", "是什", "多少", "哪里", "哪个", "请问", "一下", "帮我"]
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Normalization and validation
# ---------------------------------------------------------------------------


def normalize_key(key: Any) -> str:
    """Lowercase, trim each "/" segment, collapse inner whitespace and drop empty segments.

    "Server / HK1/" and "server/hk1" are the same record."""
    if not isinstance(key, str):
        raise ValueError("key must be a string")
    segments = (" ".join(segment.split()) for segment in key.strip().lower().split("/"))
    normalized = "/".join(segment for segment in segments if segment)
    if not normalized:
        raise ValueError("key must not be empty")
    if len(normalized) > MAX_KEY_LENGTH:
        raise ValueError(f"key must be at most {MAX_KEY_LENGTH} characters")
    if any(ord(c) < 32 or ord(c) == 127 for c in normalized):
        raise ValueError("key must not contain control characters")
    return normalized


def _http_key(key: Any) -> str:
    try:
        return normalize_key(key)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid key: {exc}.") from exc


class RecordWrite(BaseModel):
    """Fields of a record write. None means "not given": kept on a merge, defaulted on a replace.

    In `fields`, a None value removes that field on a merge."""

    kind: Optional[str] = Field(None, description=f"Short slug, e.g. {', '.join(SUGGESTED_KINDS)}.")
    title: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = Field(None, max_length=MAX_DESCRIPTION_LENGTH)
    tags: Optional[List[str]] = None
    fields: Optional[Dict[str, Any]] = None
    # Where the write comes from (see provenance.py); X-Norn-M-* headers fill in what is not given here.
    project: Optional[str] = Field(None, description="Project this record belongs to, e.g. the repository name.")
    cwd: Optional[str] = Field(None, description="Working folder the record was written from.")
    device: Optional[str] = Field(None, description="Device, e.g. mac, windows, phone, web, hermes.")
    agent: Optional[str] = Field(None, description="Agent that wrote it, e.g. claude-code, omp, devin.")

    def source(self) -> Dict[str, str]:
        """The provenance fields given in this write, cleaned."""
        return provenance.from_request(None, self.model_dump(include=set(provenance.FIELDS)))

    @field_validator("kind")
    @classmethod
    def _kind(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        value = value.strip().lower()
        if not KIND_RE.match(value):
            raise ValueError("kind must be 1-32 lowercase letters, digits, '-' or '_'")
        return value

    @field_validator("tags")
    @classmethod
    def _tags(cls, value: Optional[List[str]]) -> Optional[List[str]]:
        if value is None:
            return None
        tags = list(dict.fromkeys(" ".join(tag.split()) for tag in value if tag and tag.strip()))
        if len(tags) > MAX_TAGS:
            raise ValueError(f"at most {MAX_TAGS} tags")
        if any(len(tag) > MAX_TAG_LENGTH for tag in tags):
            raise ValueError(f"tags must be at most {MAX_TAG_LENGTH} characters")
        return tags

    @field_validator("fields")
    @classmethod
    def _fields(cls, value: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        if value is None:
            return None
        if len(value) > MAX_FIELDS:
            raise ValueError(f"at most {MAX_FIELDS} fields")
        cleaned = {}
        for name, item in value.items():
            name = name.strip()
            if not name or len(name) > MAX_FIELD_NAME_LENGTH:
                raise ValueError(f"field names must be 1-{MAX_FIELD_NAME_LENGTH} characters")
            cleaned[name] = item
        return cleaned


class RecordPut(RecordWrite):
    user_id: Optional[str] = None
    merge: bool = Field(False, description="True: change only the given fields. False: replace the record.")
    if_version: Optional[int] = Field(
        None, ge=0, description="Only write if the record is at this version (0: only if it does not exist yet)."
    )


class BatchItem(RecordWrite):
    key: str


class BatchPut(BaseModel):
    user_id: Optional[str] = None
    merge: bool = False
    records: List[BatchItem] = Field(..., min_length=1, max_length=BATCH_LIMIT)


# ---------------------------------------------------------------------------
# Scope
# ---------------------------------------------------------------------------


def resolve_user(scope: Optional[KeyScope], user_id: Optional[str], *, write: bool) -> str:
    """The user whose records a call reads or writes, after the API key's scope is checked.

    Records belong to a user only, so a key limited by agent, run or category cannot use them."""
    user_id = user_id.strip() if isinstance(user_id, str) else user_id
    if scope is not None:
        if write:
            scope.require_write()
        if scope.agent_ids or scope.run_ids or scope.categories:
            raise HTTPException(
                status_code=403,
                detail=(
                    "This API key is limited to certain agents, runs or categories. Exact records belong to a "
                    "user only, so they need an unscoped key or one limited by user_id alone."
                ),
            )
        user_id = user_id or scope.default_ids({}).get("user_id")
        if user_id:
            scope.check_ids({"user_id": user_id})
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id is required: pass it, or set the X-Norn-M-User-Id header.")
    return user_id


# ---------------------------------------------------------------------------
# Search text and query terms
# ---------------------------------------------------------------------------


def _flatten(value: Any) -> Iterable[str]:
    if value is None:
        return
    if isinstance(value, dict):
        for name, item in value.items():
            yield str(name)
            yield from _flatten(item)
    elif isinstance(value, (list, tuple)):
        for item in value:
            yield from _flatten(item)
    elif isinstance(value, bool):
        yield "true" if value else "false"
    else:
        yield str(value)


def build_search_text(
    key: str, kind: str, title: str, description: str, tags: List[str], fields: Dict[str, Any]
) -> str:
    """Everything keyword search looks at, one part per line. Field values are searched too."""
    parts = [key, kind, title, " ".join(tags)]
    parts += [f"{name}: {' '.join(_flatten(value))}" for name, value in fields.items()]
    parts.append(description)
    return "\n".join(part for part in parts if part)


def _cjk_terms(run: str) -> List[str]:
    """A CJK run has no word breaks, so it is matched by its overlapping two-character pieces."""
    if len(run) <= 2:
        return [run]
    return [run[i : i + 2] for i in range(len(run) - 1)]


def query_terms(query: str) -> List[str]:
    """Lowercased search terms, without filler words, in order and without duplicates."""
    raw: List[str] = []
    for match in _TERM_RE.finditer(query.lower()):
        token = match.group(0).strip(".:-_/")
        if not token:
            continue
        raw.extend(_cjk_terms(token) if re.match(rf"[{_CJK}]", token) else [token])
    terms = [t for t in raw if not (t in _STOPWORDS or t in _CJK_STOPWORDS or (len(t) < 2 and t.isascii()))]
    # A query made only of filler words still searches for them.
    return list(dict.fromkeys(terms or raw))[:MAX_QUERY_TERMS]


def _like(term: str) -> str:
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _prefix_like(prefix: str) -> str:
    return _like(prefix)[1:]


# ---------------------------------------------------------------------------
# Serialization
# ---------------------------------------------------------------------------


def _iso(moment: Optional[datetime]) -> Optional[str]:
    return moment.isoformat() if moment else None


def serialize(record: ExactRecord) -> Dict[str, Any]:
    return {
        "id": str(record.id),
        "user_id": record.user_id,
        "key": record.key,
        "kind": record.kind,
        "title": record.title,
        "description": record.description,
        "tags": list(record.tags or []),
        "fields": dict(record.fields or {}),
        **{field: getattr(record, field) for field in provenance.STAMPED},
        "version": record.version,
        "created_at": _iso(record.created_at),
        "updated_at": _iso(record.updated_at),
    }


def _snapshot(record: ExactRecord) -> Dict[str, Any]:
    state = serialize(record)
    for name in ("id", "user_id", "key", "version"):
        state.pop(name)
    return state


def _content(record: ExactRecord) -> Tuple[Any, ...]:
    return (record.kind, record.title, record.description, list(record.tags or []), dict(record.fields or {}))


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------


def _find(db: Session, user_id: str, key: str, *, lock: bool = False) -> Optional[ExactRecord]:
    stmt = select(ExactRecord).where(ExactRecord.user_id == user_id, ExactRecord.key == key)
    if lock:
        stmt = stmt.with_for_update()
    return db.scalars(stmt).first()


def get_record(user_id: str, key: str) -> Optional[Dict[str, Any]]:
    key = _http_key(key)
    with SessionLocal() as db:
        record = _find(db, user_id, key)
        return serialize(record) if record else None


def search_records(
    user_id: str,
    query: Optional[str] = None,
    *,
    kind: Optional[str] = None,
    tag: Optional[str] = None,
    prefix: Optional[str] = None,
    device: Optional[str] = None,
    agent: Optional[str] = None,
    project: Optional[str] = None,
    cwd: Optional[str] = None,
    limit: int = 20,
    offset: int = 0,
) -> List[Dict[str, Any]]:
    """Keyword search within one user's records, or a listing by key when there is no query.

    Ranking is deterministic: exact key, then key prefix, then how many query terms appear anywhere in
    the record, then how many appear in the key or title, then trigram word similarity (which also
    catches typos), then the most recently updated. Each result carries a `match` block explaining it.
    """
    limit = max(1, min(limit, SEARCH_LIMIT))
    offset = max(0, offset)
    stmt = select(ExactRecord).where(ExactRecord.user_id == user_id)
    if kind:
        stmt = stmt.where(ExactRecord.kind == kind.strip().lower())
    if tag:
        stmt = stmt.where(ExactRecord.tags.contains([" ".join(tag.split())]))
    if prefix and prefix.strip():
        stmt = stmt.where(ExactRecord.key.like(_prefix_like(prefix.strip().lower()), escape="\\"))
    for field, value in provenance.query_filters(device=device, agent=agent, project=project, cwd=cwd).items():
        column = getattr(ExactRecord, field)
        if field == "cwd":
            # The folder itself or anything under it, with either slash style.
            stmt = stmt.where(
                or_(
                    column == value,
                    column.like(_prefix_like(value + "/"), escape="\\"),
                    column.like(_prefix_like(value + "\\"), escape="\\"),
                )
            )
        else:
            stmt = stmt.where(column == value)

    query = (query or "").strip()
    with SessionLocal() as db:
        if not query:
            rows = db.scalars(stmt.order_by(ExactRecord.key).limit(limit).offset(offset)).all()
            return [serialize(record) for record in rows]

        terms = query_terms(query)
        whole_key = query.lower()
        head = func.concat(ExactRecord.key, " ", ExactRecord.title)
        term_hits = [case((ExactRecord.search_text.ilike(_like(t), escape="\\"), 1), else_=0) for t in terms]
        head_hits = [case((head.ilike(_like(t), escape="\\"), 1), else_=0) for t in terms]
        matched = sum(term_hits, literal(0))
        head_matched = sum(head_hits, literal(0))
        is_key = case((ExactRecord.key == whole_key, 1), else_=0)
        key_prefix = case((ExactRecord.key.like(_prefix_like(whole_key), escape="\\"), 1), else_=0)
        similarity = func.word_similarity(query, ExactRecord.search_text)

        stmt = (
            stmt.add_columns(is_key, key_prefix, matched, head_matched, similarity)
            .where(
                or_(
                    ExactRecord.key == whole_key,
                    matched > 0,
                    # pg_trgm's indexable "word similar" operator, thresholded by the SET LOCAL below.
                    literal(query).op("<%")(ExactRecord.search_text),
                )
            )
            .order_by(
                is_key.desc(),
                key_prefix.desc(),
                matched.desc(),
                head_matched.desc(),
                similarity.desc(),
                ExactRecord.updated_at.desc(),
                ExactRecord.key,
            )
            .limit(limit)
            .offset(offset)
        )
        db.execute(text(f"SET LOCAL pg_trgm.word_similarity_threshold = {TRIGRAM_THRESHOLD}"))
        results = []
        for record, exact, prefixed, hits, head_count, sim in db.execute(stmt).all():
            item = serialize(record)
            item["match"] = {
                "exact_key": bool(exact),
                "key_prefix": bool(prefixed),
                "terms": terms,
                "matched_terms": int(hits),
                "similarity": round(float(sim or 0), 3),
                "score": _score(bool(exact), int(hits), int(head_count), len(terms), float(sim or 0)),
            }
            results.append(item)
        return results


def _score(exact: bool, hits: int, head_hits: int, term_count: int, similarity: float) -> float:
    """A 0-1 summary of the match, for display and thresholds. Ordering uses the raw signals."""
    if exact:
        return 1.0
    coverage = hits / term_count if term_count else 0.0
    head = head_hits / term_count if term_count else 0.0
    return round(min(1.0, 0.6 * coverage + 0.2 * head + 0.2 * similarity), 3)


def well_matched(result: Dict[str, Any]) -> bool:
    """The key matched, or at least two thirds of the query terms appear in the record: good enough to
    show next to fuzzy memory results without being asked for."""
    match = result.get("match") or {}
    if match.get("exact_key"):
        return True
    terms = len(match.get("terms") or [])
    return terms > 0 and match.get("matched_terms", 0) >= max(1, math.ceil(terms * 2 / 3))


def close_keys(user_id: str, key: str, limit: int = 5) -> List[str]:
    """Keys of the records most like `key`, for a helpful "not found"."""
    return [r["key"] for r in search_records(user_id, key.replace("/", " "), limit=limit)]


def history(user_id: str, key: str, limit: int = 20) -> Dict[str, Any]:
    key = _http_key(key)
    limit = max(1, min(limit, HISTORY_LIMIT))
    with SessionLocal() as db:
        record = _find(db, user_id, key)
        versions = db.scalars(
            select(ExactRecordVersion)
            .where(ExactRecordVersion.user_id == user_id, ExactRecordVersion.key == key)
            .order_by(ExactRecordVersion.created_at.desc(), ExactRecordVersion.version.desc())
            .limit(limit)
        ).all()
        return {
            "key": key,
            "current": serialize(record) if record else None,
            "versions": [
                {
                    "version": v.version,
                    "change": v.change,
                    "replaced_at": _iso(v.created_at),
                    **v.snapshot,
                }
                for v in versions
            ],
        }


# ---------------------------------------------------------------------------
# Writes
# ---------------------------------------------------------------------------


def _version_row(record: ExactRecord, change: str) -> ExactRecordVersion:
    """The record's current state, to keep when it is about to be updated or deleted."""
    return ExactRecordVersion(
        record_id=record.id,
        user_id=record.user_id,
        key=record.key,
        version=record.version,
        change=change,
        snapshot=_snapshot(record),
    )


def _apply(record: ExactRecord, data: RecordWrite, *, merge: bool) -> None:
    given = data.fields or {}
    if merge:
        fields = dict(record.fields or {})
        for name, value in given.items():
            if value is None:
                fields.pop(name, None)
            else:
                fields[name] = value
        record.kind = data.kind if data.kind is not None else record.kind
        record.title = data.title if data.title is not None else record.title
        record.description = data.description if data.description is not None else record.description
        record.tags = data.tags if data.tags is not None else list(record.tags or [])
    else:
        fields = {name: value for name, value in given.items() if value is not None}
        record.kind = data.kind or DEFAULT_KIND
        record.title = data.title or ""
        record.description = data.description or ""
        record.tags = data.tags or []
    record.fields = fields
    size = len(json.dumps(_snapshot(record), ensure_ascii=False, default=str).encode())
    if size > MAX_RECORD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Record {record.key} is {size} bytes; the limit is {MAX_RECORD_BYTES}. Large documents belong in memory or files.",
        )
    record.search_text = build_search_text(
        record.key, record.kind, record.title, record.description, record.tags, record.fields
    )


def _stamp(record: ExactRecord, source: Mapping[str, str]) -> None:
    for field, value in source.items():
        setattr(record, field, value)


def _put(
    db: Session,
    user_id: str,
    key: str,
    data: RecordWrite,
    *,
    merge: bool,
    if_version: Optional[int] = None,
    source: Optional[Mapping[str, str]] = None,
) -> Tuple[ExactRecord, str]:
    """Create or update one record in the session (not committed). Returns it and "created",
    "updated" or "unchanged". `source` is the write's provenance; an unchanged record keeps its own."""
    source = {**(source or {}), **data.source()}
    record = _find(db, user_id, key, lock=True)
    if if_version is not None:
        current = record.version if record else 0
        if current != if_version:
            raise HTTPException(
                status_code=409,
                detail=f"Record {key} is at version {current}, not {if_version}. Fetch it again and retry.",
            )
    if record is None:
        now = _utcnow()
        record = ExactRecord(user_id=user_id, key=key, version=1, created_at=now, updated_at=now)
        # Merging into nothing is the same as writing a new record.
        _apply(record, data, merge=False)
        _stamp(record, source)
        db.add(record)
        return record, "created"

    before = _content(record)
    previous = _version_row(record, "update")
    _apply(record, data, merge=merge)
    if _content(record) == before:
        return record, "unchanged"
    db.add(previous)
    _stamp(record, source)
    record.version += 1
    record.updated_at = _utcnow()
    return record, "updated"


def _commit(db: Session, key_hint: str) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409, detail=f"Record {key_hint} was created by another request at the same time. Retry."
        ) from exc


def put_record(
    user_id: str,
    key: str,
    data: RecordWrite,
    *,
    merge: bool,
    if_version: Optional[int] = None,
    source: Optional[Mapping[str, str]] = None,
) -> Dict[str, Any]:
    key = _http_key(key)
    with SessionLocal() as db:
        record, outcome = _put(db, user_id, key, data, merge=merge, if_version=if_version, source=source)
        _commit(db, key)
        return {**serialize(record), "result": outcome}


def put_many(
    user_id: str, items: List[BatchItem], *, merge: bool, source: Optional[Mapping[str, str]] = None
) -> Dict[str, Any]:
    """Write up to BATCH_LIMIT records in one transaction: all of them or none."""
    keys = [_http_key(item.key) for item in items]
    duplicates = sorted({k for k in keys if keys.count(k) > 1})
    if duplicates:
        raise HTTPException(status_code=400, detail=f"Duplicate keys in the batch: {', '.join(duplicates[:10])}.")
    counts = {"created": 0, "updated": 0, "unchanged": 0}
    with SessionLocal() as db:
        for key, item in zip(keys, items):
            _, outcome = _put(db, user_id, key, item, merge=merge, source=source)
            counts[outcome] += 1
            db.flush()
        _commit(db, "in this batch")
    return counts


def delete_record(user_id: str, key: str) -> bool:
    key = _http_key(key)
    with SessionLocal() as db:
        record = _find(db, user_id, key, lock=True)
        if record is None:
            return False
        db.add(_version_row(record, "delete"))
        db.delete(record)
        db.commit()
        return True
