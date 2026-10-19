"""Per-API-key scopes: read-only vs read-write access, plus allowlists of entity IDs and categories.

A key with no scopes keeps full access, as before. Dashboard logins (JWT), ADMIN_API_KEY and
AUTH_DISABLED callers are never scoped. An empty allowlist means "no restriction" on that field;
a memory is visible to a scoped key only if it passes every non-empty allowlist.
"""

from dataclasses import dataclass
from typing import Any, Iterable, Mapping, Optional

from fastapi import HTTPException

ENTITY_FIELDS = ("user_id", "agent_id", "run_id")
ACCESS_LEVELS = ("read", "read_write")


def memory_categories(item: Mapping[str, Any]) -> list[str]:
    """Categories of a memory in any of the shapes the server returns (SDK result, raw payload, export row)."""
    return item.get("categories") or (item.get("metadata") or {}).get("categories") or []


@dataclass(frozen=True)
class KeyScope:
    access: str = "read_write"
    user_ids: frozenset[str] = frozenset()
    agent_ids: frozenset[str] = frozenset()
    run_ids: frozenset[str] = frozenset()
    categories: frozenset[str] = frozenset()

    @classmethod
    def build(
        cls,
        access: Optional[str] = None,
        user_ids: Optional[Iterable[str]] = None,
        agent_ids: Optional[Iterable[str]] = None,
        run_ids: Optional[Iterable[str]] = None,
        categories: Optional[Iterable[str]] = None,
    ) -> Optional["KeyScope"]:
        """The scope for these settings, or None when they grant full access."""
        scope = cls(
            access=access or "read_write",
            user_ids=frozenset(user_ids or ()),
            agent_ids=frozenset(agent_ids or ()),
            run_ids=frozenset(run_ids or ()),
            categories=frozenset(categories or ()),
        )
        return scope if scope.restricted else None

    @property
    def read_only(self) -> bool:
        return self.access != "read_write"

    @property
    def restricts_entities(self) -> bool:
        return any(self.allowed(field) for field in ENTITY_FIELDS)

    @property
    def restricted(self) -> bool:
        return self.read_only or self.restricts_entities or bool(self.categories)

    def allowed(self, field: str) -> frozenset[str]:
        return {"user_id": self.user_ids, "agent_id": self.agent_ids, "run_id": self.run_ids}[field]

    def allows(self, memory: Mapping[str, Any]) -> bool:
        for field in ENTITY_FIELDS:
            allowed = self.allowed(field)
            if allowed and memory.get(field) not in allowed:
                return False
        return not self.categories or bool(self.categories.intersection(memory_categories(memory)))

    def filter(self, memories: Iterable[Any]) -> list[Any]:
        return [m for m in memories if isinstance(m, Mapping) and self.allows(m)]

    def filter_response(self, response: Any, ids: Mapping[str, Any]) -> Any:
        """Drop memories outside the scope from a get_all/search response.

        Graph relations cannot be checked per memory, so they are kept only when the request was
        pinned to allowed values on every restricted field and the key has no category limit.
        """
        if isinstance(response, list):
            return self.filter(response)
        if not isinstance(response, dict):
            return response
        response = dict(response)
        if isinstance(response.get("results"), list):
            response["results"] = self.filter(response["results"])
        if "relations" in response and not self.covers(ids):
            response["relations"] = []
        return response

    def covers(self, ids: Mapping[str, Any]) -> bool:
        """True when everything matching `ids` is inside the scope: each restricted field is pinned
        to an allowed value and the key has no category limit."""
        if self.categories:
            return False
        return all(
            isinstance(ids.get(field), str) and ids[field] in self.allowed(field)
            for field in ENTITY_FIELDS
            if self.allowed(field)
        )

    def default_ids(self, ids: Mapping[str, Any]) -> dict[str, Any]:
        """`ids` with each missing restricted field filled in when the key allows exactly one value."""
        filled = dict(ids)
        for field in ENTITY_FIELDS:
            allowed = self.allowed(field)
            if len(allowed) == 1 and not filled.get(field):
                filled[field] = next(iter(allowed))
        return filled

    def require_write(self) -> None:
        if self.read_only:
            raise HTTPException(status_code=403, detail="This API key is read-only.")

    def check_ids(self, ids: Mapping[str, Any], *, required: bool = False) -> None:
        """403 when a requested entity ID is outside the key's allowlist.

        With required=True every restricted field must also be named, so a write lands inside
        the key's namespace instead of next to it.
        """
        for field in ENTITY_FIELDS:
            allowed = self.allowed(field)
            if not allowed:
                continue
            value = ids.get(field)
            if value is None or value == "":
                if required:
                    raise HTTPException(
                        status_code=403,
                        detail=f"This API key is limited to certain {field} values; pass {field} explicitly.",
                    )
                continue
            if not isinstance(value, str) or value not in allowed:
                raise HTTPException(status_code=403, detail=f"This API key is not allowed to access this {field}.")

    def check_write_categories(self, categories: Any) -> None:
        """A category-limited key must tag what it writes, and only with its own categories."""
        if not self.categories:
            return
        if not isinstance(categories, list) or not categories:
            raise HTTPException(
                status_code=403,
                detail="This API key is limited to certain categories; pass metadata.categories with at least one of them.",
            )
        if any(c not in self.categories for c in categories):
            raise HTTPException(
                status_code=403, detail="This API key cannot tag memories with categories outside its allowed set."
            )
