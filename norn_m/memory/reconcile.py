"""Reconciliation of newly extracted facts against the memories already stored.

Additive extraction only ever adds, so restatements and outdated facts pile up next to the memories
they repeat. When `add(..., reconcile=True)` is used, each extracted fact is compared with its nearest
stored memories in the same scope, and one LLM call decides per fact whether to add it, skip it (already
stored), merge it into a stored memory (update) or store it in place of outdated ones (replace).

This module holds the pure part: picking the stored candidates, parsing the reply and turning it into a
plan. Memory and AsyncMemory apply the plan with their own update and delete helpers.

Every malformed or contradictory reply falls back to "add", so a bad reply never loses a fact or touches
a stored memory.
"""

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Iterable, Optional, Sequence

from norn_m.configs.prompts import RECONCILE_PROMPT, generate_reconcile_prompt

logger = logging.getLogger(__name__)

# Stored memories compared with each new fact, and the similarity they need to count as candidates.
# Restatements score 0.85 and up; contradictions ("uses Python 3.11" / "moved to 3.12") can sit near 0.6.
NEIGHBORS = 5
MIN_SCORE = 0.6
SCOPE_KEYS = ("user_id", "agent_id", "run_id")
ACTIONS = ("add", "skip", "update", "replace")

_JSON_RE = re.compile(r"\{.*\}|\[.*\]", re.DOTALL)


@dataclass
class Candidate:
    """A stored memory shown to the LLM."""

    id: str
    text: str
    created_at: Optional[str] = None


@dataclass
class Decision:
    fact: int  # 0-based index into the new facts
    action: str
    existing: list[int] = field(default_factory=list)  # 0-based indices into the candidates
    text: Optional[str] = None


@dataclass
class Plan:
    """What to do with the new facts. Indices refer to the new facts; ids to stored memories."""

    add: list[int] = field(default_factory=list)
    skip: list[tuple[int, str]] = field(default_factory=list)  # (fact, id of the memory that already says it)
    update: list[tuple[int, str, str]] = field(default_factory=list)  # (fact, memory id, its new text)
    delete: list[tuple[int, str]] = field(default_factory=list)  # (fact, id of a memory folded into an update)

    @classmethod
    def add_all(cls, count: int) -> "Plan":
        return cls(add=list(range(count)))


def _scope(payload: dict[str, Any]) -> tuple:
    return tuple(payload.get(k) or None for k in SCOPE_KEYS)


def gather_candidates(
    neighbor_lists: Iterable[Iterable[Any]],
    scope: dict[str, Any],
    min_score: float = MIN_SCORE,
) -> list[Candidate]:
    """Stored memories similar enough to at least one new fact, each listed once, most similar first.

    The vector-store filter matches memories that have the scope's ids, including ones with an extra id
    (a user's memory inside a run); those belong to a narrower scope, so they are left out."""
    wanted = _scope(scope)
    best: dict[str, tuple[float, Candidate]] = {}
    for hits in neighbor_lists:
        for hit in hits or []:
            payload = getattr(hit, "payload", None) or {}
            score = getattr(hit, "score", None) or 0.0
            text = payload.get("data")
            if not text or score < min_score or _scope(payload) != wanted:
                continue
            hit_id = str(hit.id)
            if hit_id not in best or score > best[hit_id][0]:
                best[hit_id] = (score, Candidate(id=hit_id, text=text, created_at=payload.get("created_at")))
    return [candidate for _, candidate in sorted(best.values(), key=lambda item: -item[0])]


def build_messages(facts: Sequence[str], candidates: Sequence[Candidate]) -> list[dict[str, str]]:
    stored = [{"text": c.text, "created_at": c.created_at} for c in candidates]
    return [
        {"role": "system", "content": RECONCILE_PROMPT},
        {"role": "user", "content": generate_reconcile_prompt(list(facts), stored)},
    ]


def result_entries(
    plan: Plan,
    facts: Sequence[str],
    candidates: Sequence[Candidate],
    failed_facts: set[int] = frozenset(),
    failed_deletes: set[str] = frozenset(),
) -> list[dict]:
    """add() result entries for the stored memories a plan touched: UPDATE, DELETE, and NONE for a fact
    skipped because a stored memory already says it. A fact in `failed_facts` (its update raised) is added
    instead and its deletes are not run, so it reports nothing here; nor does a delete in `failed_deletes`."""
    by_id = {c.id: c for c in candidates}
    entries = []
    for fact, memory_id, text in plan.update:
        if fact not in failed_facts:
            entries.append(
                {"id": memory_id, "memory": text, "event": "UPDATE", "previous_memory": by_id[memory_id].text}
            )
    for fact, memory_id in plan.delete:
        if fact not in failed_facts and memory_id not in failed_deletes:
            entries.append({"id": memory_id, "memory": by_id[memory_id].text, "event": "DELETE"})
    for fact, memory_id in plan.skip:
        entries.append({"id": memory_id, "memory": by_id[memory_id].text, "event": "NONE", "fact": facts[fact]})
    return entries


def _number(value: Any, count: int) -> Optional[int]:
    """1-based number from the LLM -> 0-based index, or None when it is not one of the numbers shown."""
    if isinstance(value, bool):
        return None
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number - 1 if 1 <= number <= count else None


def parse_decisions(response: Any, fact_count: int, candidate_count: int) -> dict[int, Decision]:
    """Valid decisions from an LLM reply, keyed by fact index. Anything malformed is dropped (and so added)."""
    if isinstance(response, dict):
        response = response.get("content") or ""
    match = _JSON_RE.search(str(response or ""))
    if not match:
        return {}
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError:
        return {}
    items = data.get("decisions") if isinstance(data, dict) else data
    if not isinstance(items, list):
        return {}

    decisions: dict[int, Decision] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        fact = _number(item.get("fact"), fact_count)
        action = str(item.get("action") or "").strip().lower()
        if fact is None or fact in decisions or action not in ACTIONS:
            continue
        raw = item.get("existing")
        raw = raw if isinstance(raw, list) else [raw] if raw is not None else []
        existing: list[int] = []
        for value in raw:
            index = _number(value, candidate_count)
            if index is not None and index not in existing:
                existing.append(index)
        text = str(item.get("text") or "").strip() or None
        if action != "add" and not existing:
            continue
        if action == "update" and not text:
            continue
        decisions[fact] = Decision(fact=fact, action=action, existing=existing, text=text)
    return decisions


def build_plan(decisions: dict[int, Decision], facts: Sequence[str], candidates: Sequence[Candidate], l0_memories: Optional[list] = None) -> Plan:
    """Turn decisions into a plan, in fact order. A decision that conflicts with an earlier one becomes "add":

    - skip needs its memory to survive, so it fails if an earlier decision deleted that memory;
    - update and replace rewrite their first memory and delete the rest, so they fail if any of those
      memories was already kept by a skip, rewritten or deleted.
    
    L0 integration: When a candidate is marked as L0 (layer="L0"), it takes precedence in conflicts.
    Facts that contradict L0 memories are rejected (treated as skip or forced to update the L0).
    """
    plan = Plan()
    l0_memories = l0_memories or []
    kept: set[int] = set()
    rewritten: set[int] = set()
    deleted: set[int] = set()
    for fact in range(len(facts)):
        decision = decisions.get(fact)
        if decision is None or decision.action == "add":
            plan.add.append(fact)
            continue
        targets = decision.existing
        if decision.action == "skip":
            if targets[0] in deleted:
                plan.add.append(fact)
            else:
                kept.add(targets[0])
                plan.skip.append((fact, candidates[targets[0]].id))
            continue
        if any(t in kept or t in rewritten or t in deleted for t in targets):
            plan.add.append(fact)
            continue
        text = decision.text if decision.action == "update" else facts[fact]
        rewritten.add(targets[0])
        deleted.update(targets[1:])
        plan.update.append((fact, candidates[targets[0]].id, text))
        plan.delete.extend((fact, candidates[t].id) for t in targets[1:])
    return plan


def plan_from_response(response: Any, facts: Sequence[str], candidates: Sequence[Candidate], l0_memories: Optional[list] = None) -> Plan:
    decisions = parse_decisions(response, len(facts), len(candidates))
    if not decisions:
        logger.warning("Reconcile reply had no usable decisions; adding all %d facts", len(facts))
    return build_plan(decisions, facts, candidates, l0_memories)
