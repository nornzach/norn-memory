"""Helpers for reading and patching raw memory rows in the vector store.

Shared by main.py and the routers so none of them has to import main.
"""

from datetime import date, datetime, timezone
from typing import Any, Dict, Iterable, Mapping, Optional

import provenance
from norn_m.vector_stores.pgvector import OutputData, PGVector, sql
from scopes import ENTITY_FIELDS
from server_state import get_memory_instance

ALL_MEMORIES_LIMIT = 1000
# Largest page GET /memories?page_size= returns.
PAGE_SIZE_LIMIT = 200
# How far listings scan on vector stores other than pgvector, which can't filter or page in SQL.
SCAN_LIMIT = 10_000
RESERVED_PAYLOAD_KEYS = {
    "data",
    "user_id",
    "agent_id",
    "run_id",
    "hash",
    "created_at",
    "updated_at",
    "expiration_date",
    "categories",
    "text_lemmatized",
}


def serialize_memory(row: Any) -> Dict[str, Any]:
    payload = getattr(row, "payload", None) or {}
    return {
        "id": getattr(row, "id", None),
        "memory": payload.get("data"),
        "user_id": payload.get("user_id"),
        "agent_id": payload.get("agent_id"),
        "run_id": payload.get("run_id"),
        "hash": payload.get("hash"),
        "expiration_date": payload.get("expiration_date"),
        "categories": payload.get("categories") or [],
        "metadata": {k: v for k, v in payload.items() if k not in RESERVED_PAYLOAD_KEYS},
        "created_at": payload.get("created_at"),
        "updated_at": payload.get("updated_at"),
    }


def is_expired(memory: Mapping[str, Any]) -> bool:
    """Whether a serialized memory's expiration_date is before today (UTC), as the SDK decides it."""
    value = memory.get("expiration_date")
    if not value:
        return False
    try:
        return date.fromisoformat(str(value)) < datetime.now(timezone.utc).date()
    except ValueError:
        return False


def _pg_store() -> Any:
    """The vector store when it is pgvector, which lets listings page and filter in SQL; None otherwise."""
    store = get_memory_instance().vector_store
    return store if isinstance(store, PGVector) else None


def list_rows(limit: Optional[int] = None) -> list[Any]:
    """Raw rows (id and payload), all of them unless `limit` is given."""
    store = _pg_store()
    if store is None:
        results = get_memory_instance().vector_store.list(top_k=SCAN_LIMIT if limit is None else limit)
        return results[0] if results and isinstance(results, list) and isinstance(results[0], list) else results or []
    store._ensure_collection()
    query = sql.SQL("SELECT id, payload FROM {}").format(store._col())
    params: list[Any] = []
    if limit is not None:
        query += sql.SQL(" LIMIT %s")
        params.append(limit)
    with store._get_cursor() as cur:
        cur.execute(query, params)
        return [OutputData(id=str(row[0]), score=None, payload=row[1]) for row in cur.fetchall()]


def _conditions(
    *,
    user_id: Optional[str] = None,
    agent_id: Optional[str] = None,
    run_id: Optional[str] = None,
    category: Optional[str] = None,
    source: Optional[Mapping[str, str]] = None,
    text: Optional[str] = None,
    layer: Optional[str] = None,
    show_expired: bool = True,
    scope: Any = None,
) -> tuple[list[str], list[Any]]:
    """WHERE fragments and their parameters. Each test matches the Python one it replaces
    (provenance.matcher, is_expired, KeyScope.allows), so SQL and scanned listings agree."""
    conditions: list[str] = []
    params: list[Any] = []
    for field, value in (("user_id", user_id), ("agent_id", agent_id), ("run_id", run_id)):
        if value:
            conditions.append("payload->>%s = %s")
            params += [field, value]
    if category:
        conditions.append("payload->'categories' ? %s")
        params.append(category)
    for field, wanted in (source or {}).items():
        if field != "cwd":
            conditions.append("payload->>%s = %s")
            params += [field, wanted]
        elif wanted in ("/", "\\"):
            conditions.append("coalesce(payload->>'cwd', '') <> ''")
        else:
            # The folder itself, or anything under it with either slash style (provenance.under).
            conditions.append("(payload->>'cwd' = %s OR left(payload->>'cwd', %s) IN (%s, %s))")
            params += [wanted, len(wanted) + 1, wanted + "/", wanted + "\\"]
    if text:
        conditions.append("strpos(lower(payload->>'data'), lower(%s)) > 0")
        params.append(text)
    if layer:
        # Same normalization _layer_totals uses: a stored layer outside L0..L4 counts as the default.
        conditions.append(
            "(CASE WHEN payload->>'layer' = ANY(ARRAY[HIERARCHY_PLACEHOLDER]) THEN payload->>'layer' "
            "ELSE %s END) = %s"
        )
        params += [DEFAULT_LAYER, layer]
        # Substitute the literal once, after params are placed: identifiers can't be parameters.
        conditions[-1] = conditions[-1].replace(
            "HIERARCHY_PLACEHOLDER",
            ",".join("'" + known + "'" for known in HIERARCHY_LAYERS),
        )
    if not show_expired:
        conditions.append(
            "NOT (coalesce(payload->>'expiration_date', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'"
            " AND payload->>'expiration_date' < %s)"
        )
        params.append(datetime.now(timezone.utc).date().isoformat())
    if scope is not None:
        for field in ENTITY_FIELDS:
            allowed = scope.allowed(field)
            if allowed:
                conditions.append("payload->>%s = ANY(%s)")
                params += [field, sorted(allowed)]
        if scope.categories:
            conditions.append("payload->'categories' ?| %s")
            params.append(sorted(scope.categories))
    return conditions, params


def _where(conditions: list[str]) -> Any:
    # The fragments are fixed strings from _conditions(); every value travels as a parameter.
    return sql.SQL(" WHERE " + " AND ".join(conditions) if conditions else "")


def _scan_memories(
    limit: Optional[int],
    *,
    user_id: Optional[str] = None,
    agent_id: Optional[str] = None,
    run_id: Optional[str] = None,
    category: Optional[str] = None,
    source: Optional[Mapping[str, str]] = None,
    layer: Optional[str] = None,
    text: Optional[str] = None,
    show_expired: bool = True,
    scope: Any = None,
) -> list[Dict[str, Any]]:
    """The listing without SQL, for vector stores other than pgvector: filters after a capped scan."""
    if limit is None or any([user_id, agent_id, run_id, category, source, text, layer, scope]):
        scan = SCAN_LIMIT
    elif not show_expired:
        # Only expiry to filter: a wider window than the limit, the way the SDK's get_all fetches.
        scan = min(SCAN_LIMIT, max(limit * 4, 60))
    else:
        scan = limit
    memories = [serialize_memory(row) for row in list_rows(scan)]
    if user_id:
        memories = [m for m in memories if m["user_id"] == user_id]
    if agent_id:
        memories = [m for m in memories if m["agent_id"] == agent_id]
    if run_id:
        memories = [m for m in memories if m["run_id"] == run_id]
    if category:
        memories = [m for m in memories if category in m["categories"]]
    if source:
        matches = provenance.matcher(source)
        memories = [m for m in memories if matches(m)]
    if text:
        needle = text.lower()
        memories = [m for m in memories if needle in (m["memory"] or "").lower()]
    if layer:
        memories = [
            m
            for m in memories
            if (((m.get("metadata") or {}).get("layer") in HIERARCHY_LAYERS and m["metadata"]["layer"]) or DEFAULT_LAYER)
            == layer
        ]
    if not show_expired:
        memories = [m for m in memories if not is_expired(m)]
    if scope is not None:
        memories = scope.filter(memories)
    # Newest first, as the SQL listing orders them; rows without created_at keep their order, last.
    memories.sort(key=lambda m: str(m.get("created_at") or ""), reverse=True)
    return memories


def query_memories(
    limit: Optional[int] = ALL_MEMORIES_LIMIT,
    offset: int = 0,
    *,
    user_id: Optional[str] = None,
    agent_id: Optional[str] = None,
    run_id: Optional[str] = None,
    category: Optional[str] = None,
    source: Optional[Mapping[str, str]] = None,
    layer: Optional[str] = None,
    text: Optional[str] = None,
    show_expired: bool = True,
    scope: Any = None,
) -> tuple[list[Dict[str, Any]], int]:
    """One page of serialized memories, newest first, and how many match in all.

    `limit=None` returns every match. `source` takes provenance.query_filters() (device, agent,
    project, folder), `text` is a case-insensitive substring of the memory, and `scope` a KeyScope.
    Expired memories are included unless show_expired is False, so exports and counts see everything."""
    filters = dict(
        user_id=user_id,
        agent_id=agent_id,
        run_id=run_id,
        category=category,
        source=source,
        text=text,
        layer=layer,
        show_expired=show_expired,
        scope=scope,
    )
    store = _pg_store()
    if store is None:
        memories = _scan_memories(None if offset else limit, **filters)
        end = None if limit is None else offset + limit
        return memories[offset:end], len(memories)

    conditions, params = _conditions(**filters)
    where = _where(conditions)
    store._ensure_collection()
    page = sql.SQL("SELECT id, payload FROM {}{} ORDER BY payload->>'created_at' DESC NULLS LAST, id").format(
        store._col(), where
    )
    page_params = list(params)
    if limit is not None:
        page += sql.SQL(" LIMIT %s")
        page_params.append(limit)
    if offset:
        page += sql.SQL(" OFFSET %s")
        page_params.append(offset)
    with store._get_cursor() as cur:
        cur.execute(page, page_params)
        rows = cur.fetchall()
        if limit is None and not offset:
            total = len(rows)
        else:
            cur.execute(sql.SQL("SELECT count(*) FROM {}{}").format(store._col(), where), params)
            total = cur.fetchone()[0]
    return [serialize_memory(OutputData(id=str(row[0]), score=None, payload=row[1])) for row in rows], total


HIERARCHY_LAYERS = ("L0", "L1", "L2", "L3", "L4")
# Payloads written before the layer fields existed count as working memories of middling importance.
DEFAULT_LAYER = "L3"
DEFAULT_IMPORTANCE = 5.0
DEFAULT_CONTEXT = "chat"


def _layer_totals(payloads: Iterable[Mapping[str, Any]]) -> tuple[Dict[str, Dict[str, float]], Dict[str, int]]:
    """Per-layer counts and importance sums, plus a context histogram, bucketed like the SQL below."""
    layers = {layer: {"count": 0, "total_importance": 0.0, "avg_importance": 0.0} for layer in HIERARCHY_LAYERS}
    contexts: Dict[str, int] = {}
    for payload in payloads:
        layer = payload.get("layer") if payload.get("layer") in HIERARCHY_LAYERS else DEFAULT_LAYER
        try:
            importance = float(payload.get("importance"))
        except (TypeError, ValueError):
            importance = DEFAULT_IMPORTANCE
        layers[layer]["count"] += 1
        layers[layer]["total_importance"] += importance
        context = payload.get("context") or DEFAULT_CONTEXT
        contexts[context] = contexts.get(context, 0) + 1
    for stats in layers.values():
        if stats["count"]:
            stats["avg_importance"] = round(stats["total_importance"] / stats["count"], 2)
    return layers, dict(sorted(contexts.items(), key=lambda item: (-item[1], item[0])))


def hierarchy_totals(
    *,
    user_id: Optional[str] = None,
    agent_id: Optional[str] = None,
    run_id: Optional[str] = None,
    show_expired: bool = False,
    scope: Any = None,
) -> tuple[Dict[str, Dict[str, float]], Dict[str, int]]:
    """Layer and context totals for the whole matching set, grouped in SQL where the store allows it.

    Two aggregates instead of loading every memory: the pyramid stays cheap on a store with millions
    of rows, and a caller can't make the server materialize the table.
    """
    store = _pg_store()
    if store is None:
        rows = list_rows()
        return _layer_totals(getattr(row, "payload", None) or {} for row in rows)

    conditions, params = _conditions(
        user_id=user_id, agent_id=agent_id, run_id=run_id, show_expired=show_expired, scope=scope
    )
    where = _where(conditions)
    store._ensure_collection()
    with store._get_cursor() as cur:
        cur.execute(
            sql.SQL(
                'SELECT coalesce(nullif(payload->>\'layer\', \'\'), %s), count(*), '
                'sum(CASE WHEN payload->>\'importance\' ~ \'^[0-9]+(\\.[0-9]+)?$\' '
                'THEN (payload->>\'importance\')::double precision ELSE %s END) '
                "FROM {}{} GROUP BY 1"
            ).format(store._col(), where),
            [DEFAULT_LAYER, DEFAULT_IMPORTANCE, *params],
        )
        layer_rows = cur.fetchall()
        cur.execute(
            sql.SQL(
                "SELECT coalesce(nullif(payload->>'context', ''), %s), count(*) FROM {}{} GROUP BY 1 "
                "ORDER BY count(*) DESC, 1"
            ).format(store._col(), where),
            [DEFAULT_CONTEXT, *params],
        )
        context_rows = cur.fetchall()

    layers = {layer: {"count": 0, "total_importance": 0.0, "avg_importance": 0.0} for layer in HIERARCHY_LAYERS}
    for layer, count, total in layer_rows:
        bucket = layer if layer in HIERARCHY_LAYERS else DEFAULT_LAYER
        layers[bucket]["count"] += count
        layers[bucket]["total_importance"] += float(total or 0.0)
    for stats in layers.values():
        if stats["count"]:
            stats["avg_importance"] = round(stats["total_importance"] / stats["count"], 2)
    contexts = {str(context): int(count) for context, count in context_rows}
    return layers, contexts


def list_memories(limit: Optional[int] = ALL_MEMORIES_LIMIT, **filters: Any) -> list[Dict[str, Any]]:
    """Serialized memories, newest first; query_memories() without the total. `limit=None` returns all."""
    return query_memories(limit, **filters)[0]


SOURCE_VALUES_LIMIT = 500


def list_source_values(*, scope: Any = None, **ids: Optional[str]) -> Dict[str, list[str]]:
    """The provenance values (device, agent, project, folder) present on memories, for filter menus."""
    store = _pg_store()
    if store is None:
        values: Dict[str, set[str]] = {field: set() for field in provenance.FIELDS}
        for memory in _scan_memories(None, scope=scope, **ids):
            for field in provenance.FIELDS:
                value = (memory["metadata"] or {}).get(field)
                if isinstance(value, str) and value:
                    values[field].add(value)
        return {field: sorted(found)[:SOURCE_VALUES_LIMIT] for field, found in values.items()}

    conditions, params = _conditions(scope=scope, **ids)
    store._ensure_collection()
    result: Dict[str, list[str]] = {}
    with store._get_cursor() as cur:
        for field in provenance.FIELDS:
            where = _where(conditions + ["coalesce(payload->>%s, '') <> ''"])
            cur.execute(
                sql.SQL('SELECT DISTINCT payload->>%s COLLATE "C" AS value FROM {}{} ORDER BY value LIMIT %s').format(
                    store._col(), where
                ),
                [field, *params, field, SOURCE_VALUES_LIMIT],
            )
            result[field] = [row[0] for row in cur.fetchall()]
    return result


def iter_payloads() -> list[Dict[str, Any]]:
    return [getattr(row, "payload", None) or {} for row in list_rows()]


def patch_payload(memory_id: str, updates: Dict[str, Any], remove: Iterable[str] = ()) -> bool:
    """Merge `updates` into a memory's payload (and drop the `remove` keys) without
    re-embedding it. Returns False if the memory no longer exists."""
    vector_store = get_memory_instance().vector_store
    row = vector_store.get(vector_id=memory_id)
    if row is None:
        return False
    payload = dict(getattr(row, "payload", None) or {})
    payload.update(updates)
    for key in remove:
        payload.pop(key, None)
    vector_store.update(vector_id=memory_id, payload=payload)
    return True
