"""Where a memory or exact record came from: device, agent, project, working folder and API key.

Device and agent are fixed per connection, so each agent's MCP config sends them once as headers
(X-Mem0-Device: mac, X-Mem0-Agent: claude-code). Project and folder change from session to session,
so agents pass them on each write; X-Mem0-Project and X-Mem0-Cwd are fallbacks for agents pinned to
one project. The label of the API key that made the write is added here and cannot be set by callers.

Memories keep these as metadata fields, not agent_id: agent_id is a scope that API keys can be limited
to, and every agent configured with the same user must still share one memory. Exact records keep them
as columns.
"""

from typing import Any, Callable, Dict, Mapping, Optional

from fastapi import HTTPException, Request

FIELDS = ("device", "agent", "project", "cwd")
KEY_LABEL = "key_label"
STAMPED = FIELDS + (KEY_LABEL,)
HEADERS = {
    "device": "X-Mem0-Device",
    "agent": "X-Mem0-Agent",
    "project": "X-Mem0-Project",
    "cwd": "X-Mem0-Cwd",
}
MAX_LENGTH = {"device": 64, "agent": 64, "project": 255, "cwd": 1024}
# Device, agent and project group memories, so "Mac" and "mac" must land in the same group.
_FOLDED = {"device", "agent", "project"}


def clean(field: str, value: Any) -> Optional[str]:
    """The stored form of one field, or None when empty. Raises 400 for values that cannot be stored."""
    if value is None:
        return None
    if not isinstance(value, str):
        raise HTTPException(status_code=400, detail=f"{field} must be a string.")
    if any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise HTTPException(status_code=400, detail=f"{field} must not contain control characters.")
    if field in _FOLDED:
        value = " ".join(value.split()).lower()
    else:
        value = value.strip()
        # "/repo/" and "/repo" are the same folder; keep a bare root ("/", "C:\") as it is.
        while len(value) > 1 and value[-1] in "/\\" and not value.endswith(":\\"):
            value = value[:-1]
    if not value:
        return None
    if len(value) > MAX_LENGTH[field]:
        raise HTTPException(status_code=400, detail=f"{field} is longer than {MAX_LENGTH[field]} characters.")
    return value


def from_request(request: Optional[Request], given: Optional[Mapping[str, Any]] = None) -> Dict[str, str]:
    """The provenance of a write: values the caller passed win over the connection's headers, and the
    API key label always comes from the server."""
    given = given or {}
    headers = request.headers if request is not None else {}
    stamp: Dict[str, str] = {}
    for field in FIELDS:
        value = clean(field, given.get(field)) or clean(field, headers.get(HEADERS[field]))
        if value:
            stamp[field] = value
    label = getattr(request.state, "api_key_label", None) if request is not None else None
    if label:
        stamp[KEY_LABEL] = label
    return stamp


def clean_metadata(metadata: Optional[Mapping[str, Any]]) -> Dict[str, Any]:
    """Caller metadata with any provenance fields in their stored form. key_label is dropped: only the
    server sets it, so it always names the key that really made the write."""
    cleaned = {k: v for k, v in (metadata or {}).items() if k != KEY_LABEL}
    for field in FIELDS:
        if field in cleaned:
            value = clean(field, cleaned.pop(field))
            if value:
                cleaned[field] = value
    return cleaned


def stamp_metadata(metadata: Optional[Mapping[str, Any]], request: Optional[Request]) -> Dict[str, Any]:
    """Metadata for a new memory: the caller's own fields plus its provenance."""
    stamped = clean_metadata(metadata)
    stamped.update(from_request(request, stamped))
    return stamped


def query_filters(
    device: Optional[str] = None,
    agent: Optional[str] = None,
    project: Optional[str] = None,
    cwd: Optional[str] = None,
) -> Dict[str, str]:
    """Cleaned, non-empty provenance filters. `cwd` matches that folder and everything under it."""
    values = {"device": device, "agent": agent, "project": project, "cwd": cwd}
    return {field: v for field, v in ((f, clean(f, value)) for f, value in values.items()) if v}


def under(path: Optional[str], folder: str) -> bool:
    """Whether `path` is `folder` or inside it, for either slash style."""
    if not path:
        return False
    if path == folder:
        return True
    return any(path.startswith(folder + sep) for sep in ("/", "\\")) or folder in ("/", "\\")


def _memory_value(memory: Mapping[str, Any], field: str) -> Any:
    # The admin listing nests extra payload fields under metadata; SDK results do too, but older
    # rows or other serializers may keep them at the top level.
    metadata = memory.get("metadata")
    if isinstance(metadata, Mapping) and field in metadata:
        return metadata.get(field)
    return memory.get(field)


def matcher(filters: Mapping[str, str]) -> Callable[[Mapping[str, Any]], bool]:
    """A predicate over serialized memories for the given query_filters()."""

    def matches(memory: Mapping[str, Any]) -> bool:
        for field, wanted in filters.items():
            value = _memory_value(memory, field)
            if field == "cwd":
                if not under(value if isinstance(value, str) else None, wanted):
                    return False
            elif value != wanted:
                return False
        return True

    return matches


def vector_filters(filters: Mapping[str, str]) -> Dict[str, Any]:
    """The same filters in the SDK's metadata-filter syntax, so the vector store narrows the rows.
    The folder test is a substring there; matcher() then keeps only the folder and its subfolders."""
    return {field: ({"contains": value} if field == "cwd" else value) for field, value in filters.items()}
