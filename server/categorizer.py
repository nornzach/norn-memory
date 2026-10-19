"""LLM-based category tagging for memories.

The OSS SDK has no categories, so the server keeps category definitions in the app
database and stores the assigned names in each memory's payload under `categories`.
"""

import json
import logging
import re
from typing import Any, Iterable

from db import SessionLocal
from memory_store import patch_payload
from models import Category
from server_state import get_memory_instance
from sqlalchemy import select

MAX_CATEGORIES_PER_MEMORY = 3

_JSON_RE = re.compile(r"\{.*\}|\[.*\]", re.DOTALL)


def load_categories() -> list[Category]:
    with SessionLocal() as db:
        return list(db.execute(select(Category).order_by(Category.name)).scalars())


def build_prompt(text: str, categories: Iterable[Category]) -> str:
    lines = "\n".join(f"- {c.name}: {c.description or 'no description'}" for c in categories)
    return (
        "Classify the memory below into the categories that apply. "
        f"Pick at most {MAX_CATEGORIES_PER_MEMORY}, and only from this list:\n"
        f"{lines}\n\n"
        'Answer with JSON only, in the form {"categories": ["name", ...]}. '
        'Use {"categories": []} when none apply.\n\n'
        f"Memory: {text}"
    )


def parse_categories(response: Any, allowed: Iterable[str]) -> list[str]:
    """Pull category names out of an LLM reply, keeping only known names (case-insensitive)."""
    if isinstance(response, dict):
        response = response.get("content") or ""
    match = _JSON_RE.search(str(response or ""))
    if not match:
        return []
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError:
        return []
    names = data.get("categories", []) if isinstance(data, dict) else data
    if not isinstance(names, list):
        return []

    canonical = {name.lower(): name for name in allowed}
    picked: list[str] = []
    for name in names:
        match_name = canonical.get(str(name).strip().lower())
        if match_name and match_name not in picked:
            picked.append(match_name)
    return picked[:MAX_CATEGORIES_PER_MEMORY]


def categorize(text: str, categories: list[Category]) -> list[str]:
    response = get_memory_instance().llm.generate_response(
        [{"role": "user", "content": build_prompt(text, categories)}]
    )
    return parse_categories(response, [c.name for c in categories])


def categorize_memories(items: list[tuple[str, str]]) -> int:
    """Tag each (memory_id, text) pair. Runs as a background task, so failures are logged, not raised."""
    try:
        categories = load_categories()
    except Exception:
        logging.exception("Failed to load categories")
        return 0
    if not categories:
        return 0

    tagged = 0
    for memory_id, text in items:
        try:
            if patch_payload(memory_id, {"categories": categorize(text, categories)}):
                tagged += 1
        except Exception:
            logging.exception("Failed to categorize memory %s", memory_id)
    return tagged
