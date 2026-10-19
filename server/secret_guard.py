"""Send credentials to exact records instead of fuzzy memory.

Memory text goes through the configured LLM for fact extraction, categorization and consolidation,
which may rewrite or drop it, and through the embedder. A password or API key has to come back
character for character, so writes to fuzzy memory that look like they contain one are rejected
with directions to the exact-record store (exact_store.py), which keeps values verbatim and never
sends them to a model. Set NORN_M_ALLOW_SECRETS=true to turn the check off.
"""

import math
import os
import re
from collections import Counter
from typing import Any, Iterable

from fastapi import HTTPException

ALLOW_SECRETS_ENV = "NORN_M_ALLOW_SECRETS"

# (label, pattern). Labels are shown to the caller; matched values never are.
PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("private key", re.compile(r"-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----")),
    ("Anthropic API key", re.compile(r"\bsk-ant-[A-Za-z0-9_-]{20,}")),
    ("OpenAI-style API key", re.compile(r"\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}")),
    ("Google API key", re.compile(r"\bAIza[0-9A-Za-z_-]{35}")),
    ("AWS access key", re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")),
    ("GitHub token", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})")),
    ("Slack token", re.compile(r"\bxox[abposr]-[A-Za-z0-9-]{10,}")),
    ("Stripe key", re.compile(r"\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}")),
    ("Hugging Face token", re.compile(r"\bhf_[A-Za-z0-9]{30,}")),
    ("Groq API key", re.compile(r"\bgsk_[A-Za-z0-9]{20,}")),
    ("xAI API key", re.compile(r"\bxai-[A-Za-z0-9]{20,}")),
    ("Norn-M API key", re.compile(r"\b(?:(?:nmsk|m0sk)_[A-Za-z0-9_-]{20,}|m0-[A-Za-z0-9]{30,})")),
    ("JSON Web Token", re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}")),
    ("bearer token", re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]{20,}")),
    ("password in a URL", re.compile(r"\b[a-z][a-z0-9+.-]*://[^/\s:@]+:[^/\s@]{3,}@")),
    (
        "credential assignment",
        re.compile(
            r"(?i)\b(?:api[_-]?key|secret[_-]?key|client[_-]?secret|access[_-]?token|auth[_-]?token|"
            r"password|passwd|pwd)\b[\"']?\s*[:=]\s*[\"']?[^\s\"']{8,}"
        ),
    ),
]

TOKEN_RE = re.compile(r"[A-Za-z0-9_+/=-]{32,}")
HEX_OR_UUID_RE = re.compile(r"[0-9a-fA-F-]+")
MIN_TOKEN_ENTROPY = 4.0
# Share of adjacent characters that switch between lower, upper, digit and symbol. Random keys sit
# around 0.65; CamelCase and snake_case identifiers stay under 0.4 because letters come in words.
MIN_CLASS_SWITCH_RATE = 0.45


def secrets_allowed() -> bool:
    return os.environ.get(ALLOW_SECRETS_ENV, "").lower() in {"1", "true", "yes", "on"}


def _entropy(token: str) -> float:
    counts = Counter(token)
    return -sum(n / len(token) * math.log2(n / len(token)) for n in counts.values())


def _char_class(c: str) -> int:
    return 0 if c.islower() else 1 if c.isupper() else 2 if c.isdigit() else 3


def _looks_random(token: str) -> bool:
    """Long, mixed-case, digit-bearing, high-entropy and not made of words: how generated keys look
    and identifiers, paths, commit SHAs and UUIDs don't."""
    if HEX_OR_UUID_RE.fullmatch(token):
        return False
    if not (any(c.islower() for c in token) and any(c.isupper() for c in token) and any(c.isdigit() for c in token)):
        return False
    switches = sum(_char_class(a) != _char_class(b) for a, b in zip(token, token[1:]))
    return switches / (len(token) - 1) >= MIN_CLASS_SWITCH_RATE and _entropy(token) >= MIN_TOKEN_ENTROPY


def find_secrets(text: str) -> list[str]:
    """Labels of the kinds of credential found in `text`, in pattern order, without duplicates."""
    if not text:
        return []
    found = [label for label, pattern in PATTERNS if pattern.search(text)]
    if any(_looks_random(token) for token in TOKEN_RE.findall(text)):
        found.append("high-entropy token")
    return found


def _strings(value: Any) -> Iterable[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from _strings(item)
    elif isinstance(value, (list, tuple)):
        for item in value:
            yield from _strings(item)


def check(fields: dict[str, Any]) -> None:
    """Raise a 400 if any string in `fields` (field name -> value, nested values are searched) looks like a secret."""
    if secrets_allowed():
        return
    hits: dict[str, list[str]] = {}
    for name, value in fields.items():
        labels = list(dict.fromkeys(label for text in _strings(value) for label in find_secrets(text)))
        if labels:
            hits[name] = labels
    if not hits:
        return
    where = "; ".join(f"{name}: {', '.join(labels)}" for name, labels in hits.items())
    raise HTTPException(
        status_code=400,
        detail=(
            f"Rejected: this looks like it contains a secret ({where}). Fuzzy memory passes text through an LLM "
            "that may rewrite or drop it, so exact values are not stored here. Save it as an exact record instead, "
            "which is stored verbatim and never sent to a model: the exact_set MCP tool, or PUT /exact/records/{key}. "
            'For example key "api/deepseek" with fields {"api_key": "<the key>", "base_url": "..."}, or key '
            '"site/github.com" with fields {"username": "...", "password": "..."}. To make it findable from memory '
            'too, add a note without the value, such as "DeepSeek API key: exact record api/deepseek". '
            f"A server admin can turn this check off with {ALLOW_SECRETS_ENV}=true."
        ),
    )
