"""Outgoing webhook delivery.

Each delivery is a JSON POST signed with HMAC-SHA256 of the raw body, sent in the
`X-Norn-M-Signature: sha256=<hex>` header. Deliveries run on a small thread pool so
memory requests never wait on a slow receiver.
"""

import hashlib
import hmac
import json
import logging
import secrets
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any, Optional

import httpx
from db import SessionLocal
from models import Webhook
from sqlalchemy import select

EVENTS = ("memory.created", "memory.updated", "memory.deleted", "memories.deleted_all")
RESULT_EVENTS = {"ADD": "memory.created", "UPDATE": "memory.updated", "DELETE": "memory.deleted"}
DELIVERY_TIMEOUT_SECONDS = 5

_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="webhook")


def generate_secret() -> str:
    return f"whsec_{secrets.token_urlsafe(32)}"


def sign(secret: str, body: bytes) -> str:
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def build_body(event: str, data: dict[str, Any]) -> bytes:
    payload = {"event": event, "data": data, "timestamp": datetime.now(timezone.utc).isoformat()}
    return json.dumps(payload, separators=(",", ":"), default=str).encode()


def deliver(
    webhook_id: uuid.UUID, url: str, secret: str, event: str, body: bytes
) -> tuple[Optional[int], Optional[str]]:
    """POST one delivery and record the outcome on the webhook row."""
    status_code: Optional[int] = None
    error: Optional[str] = None
    try:
        response = httpx.post(
            url,
            content=body,
            headers={
                "Content-Type": "application/json",
                "User-Agent": "norn-m-webhooks",
                "X-Norn-M-Event": event,
                "X-Norn-M-Signature": sign(secret, body),
            },
            timeout=DELIVERY_TIMEOUT_SECONDS,
        )
        status_code = response.status_code
        if not response.is_success:
            error = f"HTTP {status_code}"
    except httpx.HTTPError as exc:
        error = str(exc) or type(exc).__name__

    try:
        with SessionLocal() as db:
            webhook = db.get(Webhook, webhook_id)
            if webhook is not None:
                webhook.last_delivery_at = datetime.now(timezone.utc)
                webhook.last_status_code = status_code
                webhook.last_error = error
                db.commit()
    except Exception:
        logging.exception("Failed to record webhook delivery for %s", webhook_id)
    return status_code, error


def subscribers(event: str) -> list[tuple[uuid.UUID, str, str]]:
    with SessionLocal() as db:
        webhooks = db.execute(select(Webhook).where(Webhook.is_active.is_(True))).scalars().all()
        return [(w.id, w.url, w.secret) for w in webhooks if event in (w.events or [])]


def emit(event: str, data: dict[str, Any]) -> None:
    """Queue a delivery to every active webhook subscribed to `event`. Never raises."""
    try:
        targets = subscribers(event)
    except Exception:
        logging.exception("Failed to load webhooks for %s", event)
        return
    if not targets:
        return
    body = build_body(event, data)
    for webhook_id, url, secret in targets:
        _executor.submit(deliver, webhook_id, url, secret, event, body)


def emit_memory_results(results: list[dict[str, Any]], scope: dict[str, Any]) -> None:
    """Emit one event per memory change returned by Memory.add()."""
    for result in results:
        event = RESULT_EVENTS.get(str(result.get("event", "")).upper())
        if event:
            emit(event, {**scope, **result})
