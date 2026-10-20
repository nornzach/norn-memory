import asyncio
import importlib.util
import logging
import os
import sys
import time
import uuid
from typing import Any, Dict, List, Optional

import categorizer
import config_check
import provenance
import secret_guard
import webhooks
from auth import (
    ADMIN_API_KEY,
    AUTH_DISABLED,
    JWT_SECRET,
    get_key_scope,
    require_admin,
    verify_auth,
    verify_unscoped,
)
from db import SessionLocal
from dotenv import load_dotenv
from errors import (
    UpstreamError,
    install_request_id_logging,
    new_request_id,
    request_id_var,
    upstream_error,
    upstream_error_handler,
)
from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from memory_store import ALL_MEMORIES_LIMIT, SCAN_LIMIT, list_memories
from models import RequestLog, User
from pydantic import BaseModel, Field
from rate_limit import limiter
from routers import analytics as analytics_router
from routers import api_keys as api_keys_router
from routers import auth as auth_router
from routers import categories as categories_router
from routers import consolidation as consolidation_router
from routers import entities as entities_router
from routers import exact as exact_router
from routers import export as export_router
from routers import imports as imports_router
from routers import agent_hooks as agent_hooks_router
from routers import requests as requests_router
from routers import webhooks as webhooks_router
from schemas import MessageResponse
from scopes import KeyScope, memory_categories
from server_state import (
    apply_config_updates,
    get_current_config,
    get_memory_instance,
    initialize_state,
    set_session_factory,
    update_config,
)
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from sqlalchemy import func, select

from norn_m.exceptions import ValidationError as NornMValidationError

load_dotenv()

install_request_id_logging()
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - [%(request_id)s] %(message)s")

MIN_KEY_LENGTH = 16
SENSITIVE_CONFIG_KEYS = {
    "admin_api_key",
    "api_key",
    "authorization",
    "jwt_secret",
    "password",
    "password_hash",
    "secret",
    "token",
}
SKIPPED_REQUEST_LOG_PATHS = {"/api/health", "/docs", "/redoc", "/openapi.json"}
SKIPPED_REQUEST_LOG_PREFIXES = ("/requests",)

BUNDLED_LLM_PROVIDERS = ("openai", "anthropic", "gemini", "deepseek")
BUNDLED_EMBEDDER_PROVIDERS = ("openai", "gemini")


def _warn_if_unconfigured() -> None:
    """Pre-auth deployments upgrading into this build will 401 everywhere until
    an admin key or admin user exists. Surface the fix before the support tickets."""
    try:
        with SessionLocal() as session:
            if session.scalar(select(func.count(User.id))) > 0:
                return
    except Exception:
        return

    logging.warning(
        "\n%s\n"
        "  Auth is enabled by default and this server has no admin configured.\n"
        "  Protected endpoints will return 401 until you either:\n"
        "    1. Set ADMIN_API_KEY=<long-random-value>  (fastest, no client changes)\n"
        "    2. Register an admin at http://<host>:3000/setup\n"
        "    3. Set AUTH_DISABLED=true                 (local development only)\n"
        "  Docs: https://github.com/nornzach/norn-memory/blob/main/docs/api.md#authentication\n"
        "%s",
        "=" * 72,
        "=" * 72,
    )


if not AUTH_DISABLED and not JWT_SECRET:
    raise RuntimeError(
        "JWT_SECRET is required. Set it in .env (generate with `openssl rand -base64 48`) "
        "or set AUTH_DISABLED=true for local development only."
    )

if AUTH_DISABLED:
    logging.warning("AUTH_DISABLED is enabled. Protected endpoints are open for local development only.")
elif ADMIN_API_KEY and len(ADMIN_API_KEY) < MIN_KEY_LENGTH:
    logging.warning(
        "ADMIN_API_KEY is shorter than %d characters - consider using a longer key for production.",
        MIN_KEY_LENGTH,
    )
elif not ADMIN_API_KEY:
    _warn_if_unconfigured()

if secret_guard.secrets_allowed():
    logging.warning(
        "%s=true: memory writes are not checked for credentials. Anything stored is sent to the LLM provider.",
        secret_guard.ALLOW_SECRETS_ENV,
    )

POSTGRES_HOST = os.environ.get("POSTGRES_HOST", "postgres")
POSTGRES_PORT = os.environ.get("POSTGRES_PORT", "5432")
POSTGRES_DB = os.environ.get("POSTGRES_DB", "postgres")
POSTGRES_USER = os.environ.get("POSTGRES_USER", "postgres")
POSTGRES_PASSWORD = os.environ.get("POSTGRES_PASSWORD", "postgres")
POSTGRES_COLLECTION_NAME = os.environ.get("POSTGRES_COLLECTION_NAME", "memories")

PROVIDER_API_KEY_ENV = {
    "openai": "OPENAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "gemini": "GOOGLE_API_KEY",
    "deepseek": "DEEPSEEK_API_KEY",
}

HISTORY_DB_PATH = os.environ.get("HISTORY_DB_PATH", "/app/history/history.db")
DEFAULT_LLM_PROVIDER = os.environ.get("NORN_M_DEFAULT_LLM_PROVIDER", "openai")
DEFAULT_LLM_MODEL = os.environ.get("NORN_M_DEFAULT_LLM_MODEL", "gpt-5-mini")
DEFAULT_EMBEDDER_PROVIDER = os.environ.get("NORN_M_DEFAULT_EMBEDDER_PROVIDER", "openai")
DEFAULT_EMBEDDER_MODEL = os.environ.get("NORN_M_DEFAULT_EMBEDDER_MODEL", "text-embedding-3-small")
# Must match the embedder's output size; pgvector creates the column with this width.
DEFAULT_EMBEDDER_DIMS = int(os.environ.get("NORN_M_DEFAULT_EMBEDDER_DIMS", "1536"))

if DEFAULT_LLM_PROVIDER not in BUNDLED_LLM_PROVIDERS:
    raise RuntimeError(f"NORN_M_DEFAULT_LLM_PROVIDER must be one of: {', '.join(BUNDLED_LLM_PROVIDERS)}")
if DEFAULT_EMBEDDER_PROVIDER not in BUNDLED_EMBEDDER_PROVIDERS:
    raise RuntimeError(f"NORN_M_DEFAULT_EMBEDDER_PROVIDER must be one of: {', '.join(BUNDLED_EMBEDDER_PROVIDERS)}")

DEFAULT_CONFIG = {
    "version": "v1.1",
    "vector_store": {
        "provider": "pgvector",
        "config": {
            "host": POSTGRES_HOST,
            "port": int(POSTGRES_PORT),
            "dbname": POSTGRES_DB,
            "user": POSTGRES_USER,
            "password": POSTGRES_PASSWORD,
            "collection_name": POSTGRES_COLLECTION_NAME,
            "embedding_model_dims": DEFAULT_EMBEDDER_DIMS,
        },
    },
    "llm": {
        "provider": DEFAULT_LLM_PROVIDER,
        "config": {
            "api_key": os.environ.get(PROVIDER_API_KEY_ENV[DEFAULT_LLM_PROVIDER]),
            "temperature": 0.2,
            "model": DEFAULT_LLM_MODEL,
        },
    },
    "embedder": {
        "provider": DEFAULT_EMBEDDER_PROVIDER,
        "config": {
            "api_key": os.environ.get(PROVIDER_API_KEY_ENV[DEFAULT_EMBEDDER_PROVIDER]),
            "model": DEFAULT_EMBEDDER_MODEL,
            "embedding_dims": DEFAULT_EMBEDDER_DIMS,
        },
    },
    "history_db_path": HISTORY_DB_PATH,
}


set_session_factory(SessionLocal)
initialize_state(DEFAULT_CONFIG)


app = FastAPI(
    title="Norn-M REST APIs",
    description=(
        "A REST API for managing and searching memories for your AI Agents and Apps.\n\n"
        "## Authentication\n"
        "Supports Bearer JWT tokens, per-user API keys via `X-API-Key` header, "
        "or the legacy `ADMIN_API_KEY` environment variable. Set `AUTH_DISABLED=true` for local development only."
    ),
    version="1.0.0",
    redirect_slashes=False,
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_exception_handler(UpstreamError, upstream_error_handler)
DASHBOARD_URL = os.environ.get("DASHBOARD_URL", "http://localhost:3000")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[DASHBOARD_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router)
app.include_router(api_keys_router.router)
app.include_router(entities_router.router)
app.include_router(requests_router.router)
app.include_router(categories_router.router)
app.include_router(consolidation_router.router)
app.include_router(webhooks_router.router)
app.include_router(analytics_router.router)
app.include_router(export_router.router)
app.include_router(imports_router.router)
app.include_router(agent_hooks_router.router)
app.include_router(exact_router.router)


class Message(BaseModel):
    role: str = Field(..., description="Role of the message (user or assistant).")
    content: str = Field(..., description="Message content.")


class MemoryCreate(BaseModel):
    messages: List[Message] = Field(..., description="List of messages to store.")
    user_id: Optional[str] = None
    agent_id: Optional[str] = None
    run_id: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
    expiration_date: Optional[str] = Field(None, description="Expiration date in YYYY-MM-DD format.")
    infer: Optional[bool] = Field(None, description="Whether to extract facts from messages. Defaults to True.")
    memory_type: Optional[str] = Field(None, description="Type of memory to store (e.g. 'core').")
    prompt: Optional[str] = Field(None, description="Custom prompt to use for fact extraction.")
    # Provenance (see provenance.py), stored in metadata. Each wins over the same key in metadata and
    # over the X-Norn-M-* header; device and agent are usually set once per connection by header instead.
    project: Optional[str] = Field(None, description="Project or repository this memory belongs to.")
    cwd: Optional[str] = Field(None, description="Working folder the memory was recorded in.")
    device: Optional[str] = Field(None, description="Device it was written from, e.g. 'mac' or 'phone'.")
    agent: Optional[str] = Field(None, description="Agent that wrote it, e.g. 'claude-code'.")


class MemoryUpdate(BaseModel):
    text: Optional[str] = Field(None, description="New content to update the memory with.")
    metadata: Optional[Dict[str, Any]] = Field(None, description="Metadata to update.")
    expiration_date: Optional[str] = Field(None, description="Expiration date in YYYY-MM-DD format, or null to clear.")


class SearchRequest(BaseModel):
    query: str = Field(..., description="Search query.")
    user_id: Optional[str] = Field(None, description="Deprecated: pass inside `filters` instead.", deprecated=True)
    run_id: Optional[str] = Field(None, description="Deprecated: pass inside `filters` instead.", deprecated=True)
    agent_id: Optional[str] = Field(None, description="Deprecated: pass inside `filters` instead.", deprecated=True)
    filters: Optional[Dict[str, Any]] = None
    top_k: Optional[int] = Field(None, description="Maximum number of results to return.")
    threshold: Optional[float] = Field(None, description="Minimum similarity score for results.")
    explain: Optional[bool] = Field(None, description="Include score details for each search result.")
    show_expired: Optional[bool] = Field(None, description="Include expired memories.")
    device: Optional[str] = Field(None, description="Only memories written from this device, e.g. 'mac'.")
    agent: Optional[str] = Field(None, description="Only memories written by this agent, e.g. 'claude-code'.")
    project: Optional[str] = Field(None, description="Only memories recorded for this project.")
    cwd: Optional[str] = Field(None, description="Only memories recorded in this folder or one under it.")


class GenerateInstructionsRequest(BaseModel):
    use_case: str = Field(..., description="Description of what the user will use Norn-M for.")


def _client_error(exc: Exception) -> HTTPException:
    """Map core validation / not-found errors to 4xx so clients can tell a bad
    request from an upstream outage. 'not found' is a 404, everything else a 400."""
    detail = str(exc)
    status_code = 404 if isinstance(exc, ValueError) and "not found" in detail.lower() else 400
    return HTTPException(status_code=status_code, detail=detail)


def _redact_config(value: Any, key: str | None = None) -> Any:
    if isinstance(value, dict):
        return {item_key: _redact_config(item_value, item_key) for item_key, item_value in value.items()}
    if isinstance(value, list):
        return [_redact_config(item_value, key) for item_value in value]
    if key is not None and key.lower() in SENSITIVE_CONFIG_KEYS:
        return "[redacted]" if value else value
    return value


def _validate_bundled_providers(config: Dict[str, Any]) -> None:
    llm = config.get("llm")
    if isinstance(llm, dict) and (provider := llm.get("provider")) and provider not in BUNDLED_LLM_PROVIDERS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"LLM provider '{provider}' is not bundled in this image. "
                f"Bundled providers: {', '.join(BUNDLED_LLM_PROVIDERS)}. "
                "To use another provider, install its Python package, rebuild the container, "
                "and extend BUNDLED_LLM_PROVIDERS in server/main.py."
            ),
        )

    embedder = config.get("embedder")
    if (
        isinstance(embedder, dict)
        and (provider := embedder.get("provider"))
        and provider not in BUNDLED_EMBEDDER_PROVIDERS
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Embedder provider '{provider}' is not bundled in this image. "
                f"Bundled providers: {', '.join(BUNDLED_EMBEDDER_PROVIDERS)}. "
                "To use another provider, install its Python package, rebuild the container, "
                "and extend BUNDLED_EMBEDDER_PROVIDERS in server/main.py."
            ),
        )


def _validate_base_urls(config: Dict[str, Any]) -> None:
    for section in ("llm", "embedder"):
        provider_config = (config.get(section) or {}).get("config") or {}
        for key, value in provider_config.items():
            if not key.endswith("_base_url") or value is None:
                continue
            if not isinstance(value, str) or not value.startswith(("http://", "https://")):
                raise HTTPException(status_code=400, detail=f"{section}.config.{key} must be an http(s) URL.")


def _validate_config_update(config: Dict[str, Any]) -> Dict[str, Any]:
    """Check an update and return the full config it would produce, without applying it."""
    _validate_bundled_providers(config)
    _validate_base_urls(config)
    return apply_config_updates(get_current_config(), config)


def _should_log_request(request: Request) -> bool:
    if request.method == "OPTIONS":
        return False
    path = request.url.path
    if path in SKIPPED_REQUEST_LOG_PATHS:
        return False
    return not path.startswith(SKIPPED_REQUEST_LOG_PREFIXES)


def _persist_request_log(
    method: str, path: str, status_code: int, latency_ms: float, auth_type: str, key_label: str | None = None
) -> None:
    session = SessionLocal()

    try:
        session.add(
            RequestLog(
                method=method,
                path=path,
                status_code=status_code,
                latency_ms=latency_ms,
                auth_type=auth_type,
                key_label=key_label,
            )
        )
        session.commit()
    except Exception:
        session.rollback()
        logging.exception("Failed to persist request log")
    finally:
        session.close()


@app.middleware("http")
async def log_requests(request: Request, call_next):
    request.state.auth_type = getattr(request.state, "auth_type", "none")
    rid = new_request_id()
    token = request_id_var.set(rid)
    start = time.perf_counter()
    status_code = 500

    try:
        response = await call_next(request)
        status_code = response.status_code
        response.headers["X-Request-ID"] = rid
        return response
    except Exception:
        status_code = 500
        raise
    finally:
        request_id_var.reset(token)
        if _should_log_request(request):
            asyncio.get_running_loop().run_in_executor(
                None,
                _persist_request_log,
                request.method,
                request.url.path,
                status_code,
                round((time.perf_counter() - start) * 1000, 2),
                getattr(request.state, "auth_type", "none"),
                getattr(request.state, "api_key_label", None),
            )


@app.get("/configure", summary="Get current Norn-M configuration")
def get_config(_auth=Depends(verify_unscoped)):
    return _redact_config(get_current_config())


@app.get("/configure/providers", summary="List bundled LLM and embedder providers")
def list_bundled_providers(_auth=Depends(verify_auth)):
    return {"llm": list(BUNDLED_LLM_PROVIDERS), "embedder": list(BUNDLED_EMBEDDER_PROVIDERS)}


@app.post("/configure/test", summary="Test an LLM and embedder configuration without saving it")
def test_config(config: Dict[str, Any], _auth=Depends(require_admin)):
    """Merge the body into the current config as POST /configure would, then send one small request
    to the LLM and one to the embedder. Nothing is saved. Requires admin role."""
    candidate = _validate_config_update(config)
    return {
        "llm": config_check.check_llm(candidate["llm"]),
        "embedder": config_check.check_embedder(candidate["embedder"], config_check.expected_embedding_dims(candidate)),
    }


@app.post("/configure", summary="Configure Norn-M")
def set_config(config: Dict[str, Any], _auth=Depends(require_admin)):
    """Set memory configuration. Requires admin role.

    A changed embedder is checked first: its vectors must fit the existing vector store."""
    candidate = _validate_config_update(config)
    if candidate.get("embedder") != get_current_config().get("embedder"):
        result = config_check.check_embedder(candidate["embedder"], config_check.expected_embedding_dims(candidate))
        if not result["ok"]:
            raise HTTPException(status_code=400, detail=f"Embedder check failed: {result['error']}")
    update_config(config)
    return {"message": "Configuration set successfully"}


@app.post("/generate-instructions", summary="Generate custom instructions from a use case")
def generate_instructions(req: GenerateInstructionsRequest, _auth=Depends(verify_unscoped)):
    """Generate custom instructions and a contextual test message tailored to a use case."""
    try:
        llm = get_memory_instance().llm
        prompt = (
            "You are configuring a memory system. Given the use case below, produce two things:\n"
            "1. INSTRUCTIONS: A short paragraph of custom instructions telling the memory extraction system "
            "what kinds of facts, preferences, and context to prioritize. Be specific to the use case.\n"
            "2. TEST_MESSAGE: A single realistic sentence a user in this use case would say, suitable for "
            "testing that the memory system works.\n\n"
            "Respond in exactly this format (no markdown, no extra text):\n"
            "INSTRUCTIONS: <your instructions>\n"
            f"TEST_MESSAGE: <your test message>\n\nUse case: {req.use_case}"
        )
        response = llm.generate_response([{"role": "user", "content": prompt}])
        instructions = response
        test_message = "I like to hike on weekends."
        if "INSTRUCTIONS:" in response and "TEST_MESSAGE:" in response:
            parts = response.split("TEST_MESSAGE:")
            instructions = parts[0].replace("INSTRUCTIONS:", "").strip()
            test_message = parts[1].strip()
        return {"custom_instructions": instructions, "test_message": test_message}
    except Exception:
        raise upstream_error()


def _scope(
    user_id: Optional[str] = None, agent_id: Optional[str] = None, run_id: Optional[str] = None
) -> Dict[str, str]:
    return {k: v for k, v in {"user_id": user_id, "agent_id": agent_id, "run_id": run_id}.items() if v}


def _has_category(item: Dict[str, Any], category: str) -> bool:
    return category in memory_categories(item)


def _keep_source(response: Any, source: Dict[str, str]) -> Any:
    """Apply provenance filters exactly. The vector store already narrowed the rows, but its folder
    test is a substring match, so "/repo" would also catch "/old/repo"."""
    if not source or not isinstance(response, dict) or not isinstance(response.get("results"), list):
        return response
    matches = provenance.matcher(source)
    return {**response, "results": [m for m in response["results"] if isinstance(m, dict) and matches(m)]}


def _check_memory_id(memory_id: str) -> None:
    """Memory ids are UUIDs, so anything else cannot exist; 404 before the vector store chokes on it."""
    try:
        uuid.UUID(memory_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Memory not found.")


def _fetch_memory(memory_id: str) -> Dict[str, Any]:
    """The memory with this id, or a 404."""
    _check_memory_id(memory_id)
    try:
        memory = get_memory_instance().get(memory_id)
    except Exception:
        raise upstream_error()
    if not isinstance(memory, dict):
        raise HTTPException(status_code=404, detail="Memory not found.")
    return memory


def _require_visible(memory_id: str, scope: Optional[KeyScope]) -> Optional[Dict[str, Any]]:
    """For a scoped key, fetch the memory and 404 unless it is inside the scope.
    Unscoped callers skip the lookup and get None."""
    if scope is None:
        return None
    memory = _fetch_memory(memory_id)
    if not scope.allows(memory):
        raise HTTPException(status_code=404, detail="Memory not found.")
    return memory


@app.post("/memories", summary="Create memories")
def add_memory(
    memory_create: MemoryCreate,
    background_tasks: BackgroundTasks,
    request: Request,
    scope: Optional[KeyScope] = Depends(get_key_scope),
):
    """Store new memories. Each one is stamped with where it came from: device, agent, project and
    folder (from metadata, or the X-Norn-M-Device/-Agent/-Project/-Cwd headers) and the API key's label."""
    if not any([memory_create.user_id, memory_create.agent_id, memory_create.run_id]):
        raise HTTPException(status_code=400, detail="At least one identifier (user_id, agent_id, run_id) is required.")
    if scope is not None:
        scope.require_write()
        scope.check_ids(_scope(memory_create.user_id, memory_create.agent_id, memory_create.run_id), required=True)
        scope.check_write_categories((memory_create.metadata or {}).get("categories"))
        if scope.categories and memory_create.infer is not False:
            raise HTTPException(
                status_code=403,
                detail=(
                    "This API key is limited to certain categories, so it must add with infer=false: "
                    "inference can update existing memories outside those categories."
                ),
            )
    given = {f: getattr(memory_create, f) for f in provenance.FIELDS if getattr(memory_create, f)}
    metadata = provenance.stamp_metadata({**(memory_create.metadata or {}), **given}, request)
    secret_guard.check(
        {
            **{f"messages[{i}].content": m.content for i, m in enumerate(memory_create.messages)},
            "metadata": metadata,
        }
    )

    params = {
        k: v
        for k, v in memory_create.model_dump().items()
        if v is not None and k != "messages" and k not in provenance.FIELDS
    }
    if metadata:
        params["metadata"] = metadata
    try:
        response = get_memory_instance().add(messages=[m.model_dump() for m in memory_create.messages], **params)
    except (ValueError, NornMValidationError) as e:
        raise _client_error(e)
    except Exception:
        raise upstream_error()

    results = response.get("results") or []
    webhooks.emit_memory_results(results, _scope(memory_create.user_id, memory_create.agent_id, memory_create.run_id))
    # Callers that pass their own categories keep them; everything else is tagged by the LLM.
    if not (memory_create.metadata or {}).get("categories"):
        to_tag = [
            (r["id"], r["memory"])
            for r in results
            if r.get("event") in ("ADD", "UPDATE") and r.get("id") and r.get("memory")
        ]
        if to_tag:
            background_tasks.add_task(categorizer.categorize_memories, to_tag)
    return JSONResponse(content=response)


@app.get("/memories", summary="Get memories")
def get_all_memories(
    request: Request,
    user_id: Optional[str] = None,
    run_id: Optional[str] = None,
    agent_id: Optional[str] = None,
    category: Optional[str] = Query(None, description="Only return memories tagged with this category."),
    device: Optional[str] = Query(None, description="Only memories written from this device."),
    agent: Optional[str] = Query(None, description="Only memories written by this agent."),
    project: Optional[str] = Query(None, description="Only memories recorded for this project."),
    cwd: Optional[str] = Query(None, description="Only memories recorded in this folder or one under it."),
    top_k: Optional[int] = Query(None, ge=0, le=ALL_MEMORIES_LIMIT),
    show_expired: bool = Query(False),
    _auth=Depends(verify_auth),
    scope: Optional[KeyScope] = Depends(get_key_scope),
):
    """Retrieve stored memories. Lists all memories when no identifier is provided (admin only).

    A scoped API key only ever sees memories inside its scope; with no identifier it lists its
    whole scope instead."""
    ids = _scope(user_id, agent_id, run_id)
    source = provenance.query_filters(device=device, agent=agent, project=project, cwd=cwd)
    if scope is not None:
        scope.check_ids(ids)
        ids = scope.default_ids(ids)
    try:
        if not ids:
            auth_type = getattr(request.state, "auth_type", "none")
            needs_admin = scope is None or not scope.restricts_entities
            if (
                needs_admin
                and _auth is not None
                and _auth.role != "admin"
                and auth_type not in {"admin_api_key", "disabled"}
            ):
                raise HTTPException(status_code=403, detail="Admin role required to list all memories.")
            # Expired memories are hidden here too unless asked for, like in get_all below.
            limit = top_k if top_k is not None else ALL_MEMORIES_LIMIT
            listed = {"category": category, "source": source, "show_expired": show_expired}
            if scope is None:
                return {"results": list_memories(limit, **listed)}
            return {"results": scope.filter(list_memories(SCAN_LIMIT, **listed))[:limit]}
        params = {"filters": {**ids, **provenance.vector_filters(source)}}
        if top_k is not None:
            params["top_k"] = top_k
        params["show_expired"] = show_expired
        response = get_memory_instance().get_all(**params)
        if category and isinstance(response, dict):
            response["results"] = [m for m in response.get("results", []) if _has_category(m, category)]
        response = _keep_source(response, source)
        return scope.filter_response(response, ids) if scope is not None else response
    except HTTPException:
        raise
    except (ValueError, NornMValidationError) as e:
        raise _client_error(e)
    except Exception:
        raise upstream_error()


@app.get("/memories/{memory_id}", summary="Get a memory")
def get_memory(memory_id: str, scope: Optional[KeyScope] = Depends(get_key_scope)):
    """Retrieve a specific memory by ID."""
    if scope is not None:
        return _require_visible(memory_id, scope)
    return _fetch_memory(memory_id)


@app.post("/search", summary="Search memories")
def search_memories(search_req: SearchRequest, scope: Optional[KeyScope] = Depends(get_key_scope)):
    """Search for memories based on a query."""
    try:
        filters = search_req.filters or {}
        deprecated_keys = []
        for entity_key in ("user_id", "agent_id", "run_id"):
            entity_val = getattr(search_req, entity_key, None)
            if entity_val:
                filters[entity_key] = entity_val
                deprecated_keys.append(entity_key)
        if deprecated_keys:
            logging.warning(
                "Top-level %s in /search is deprecated. Use filters={%s} instead.",
                ", ".join(deprecated_keys),
                ", ".join(f'"{k}": "..."' for k in deprecated_keys),
            )
        if scope is not None:
            filters = scope.default_ids(filters)
            scope.check_ids(filters)
        source = provenance.query_filters(
            device=search_req.device, agent=search_req.agent, project=search_req.project, cwd=search_req.cwd
        )
        filters = {**filters, **provenance.vector_filters(source)}
        params = {}
        if search_req.top_k is not None:
            params["top_k"] = search_req.top_k
        if search_req.threshold is not None:
            params["threshold"] = search_req.threshold
        if search_req.explain is not None:
            params["explain"] = search_req.explain
        if search_req.show_expired is not None:
            params["show_expired"] = search_req.show_expired
        response = _keep_source(get_memory_instance().search(query=search_req.query, filters=filters, **params), source)
        return scope.filter_response(response, filters) if scope is not None else response
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception:
        raise upstream_error()


@app.put("/memories/{memory_id}", summary="Update a memory")
def update_memory(
    memory_id: str,
    updated_memory: MemoryUpdate,
    background_tasks: BackgroundTasks,
    scope: Optional[KeyScope] = Depends(get_key_scope),
):
    """Update an existing memory."""
    fields_set = getattr(updated_memory, "model_fields_set", getattr(updated_memory, "__fields_set__", set()))
    if scope is not None:
        scope.require_write()
        _require_visible(memory_id, scope)
        if "metadata" in fields_set and "categories" in (updated_memory.metadata or {}):
            scope.check_write_categories(updated_memory.metadata["categories"])
    _check_memory_id(memory_id)
    secret_guard.check(
        {k: v for k, v in {"text": updated_memory.text, "metadata": updated_memory.metadata}.items() if k in fields_set}
    )
    params = {"memory_id": memory_id}
    if "text" in fields_set:
        params["data"] = updated_memory.text
    if "metadata" in fields_set:
        # Provenance can be corrected (e.g. a project name) but the key label stays the original writer's.
        metadata = updated_memory.metadata
        params["metadata"] = provenance.clean_metadata(metadata) if metadata is not None else None
    if "expiration_date" in fields_set:
        params["expiration_date"] = updated_memory.expiration_date
    try:
        response = get_memory_instance().update(**params)
    except (ValueError, NornMValidationError) as e:
        raise _client_error(e)
    except Exception:
        raise upstream_error()

    webhooks.emit("memory.updated", {"id": memory_id, **{k: v for k, v in params.items() if k != "memory_id"}})
    # A category-limited key keeps the memory's categories; LLM re-tagging could move it out of the key's reach.
    if (
        "text" in fields_set
        and updated_memory.text
        and not (updated_memory.metadata or {}).get("categories")
        and not (scope is not None and scope.categories)
    ):
        background_tasks.add_task(categorizer.categorize_memories, [(memory_id, updated_memory.text)])
    return response


@app.get("/memories/{memory_id}/history", summary="Get memory history")
def memory_history(memory_id: str, scope: Optional[KeyScope] = Depends(get_key_scope)):
    """Retrieve memory history."""
    _require_visible(memory_id, scope)
    try:
        return get_memory_instance().history(memory_id=memory_id)
    except Exception:
        raise upstream_error()


@app.delete("/memories/{memory_id}", summary="Delete a memory", response_model=MessageResponse)
def delete_memory(memory_id: str, scope: Optional[KeyScope] = Depends(get_key_scope)):
    """Delete a specific memory by ID."""
    if scope is not None:
        scope.require_write()
        _require_visible(memory_id, scope)
    _check_memory_id(memory_id)
    try:
        get_memory_instance().delete(memory_id=memory_id)
    except (ValueError, NornMValidationError) as e:
        raise _client_error(e)
    except Exception:
        raise upstream_error()
    webhooks.emit("memory.deleted", {"id": memory_id})
    return MessageResponse(message="Memory deleted successfully")


@app.delete("/memories", summary="Delete all memories", response_model=MessageResponse)
def delete_all_memories(
    user_id: Optional[str] = None,
    run_id: Optional[str] = None,
    agent_id: Optional[str] = None,
    _auth=Depends(require_admin),
):
    """Delete all memories for a given identifier. Requires admin role."""
    if not any([user_id, run_id, agent_id]):
        raise HTTPException(status_code=400, detail="At least one identifier is required.")
    params = _scope(user_id, agent_id, run_id)
    try:
        get_memory_instance().delete_all(**params)
    except (ValueError, NornMValidationError) as e:
        raise _client_error(e)
    except Exception:
        raise upstream_error()
    webhooks.emit("memories.deleted_all", params)
    return MessageResponse(message="All relevant memories deleted")


@app.post("/reset", summary="Reset all memories")
def reset_memory(_auth=Depends(require_admin)):
    """Completely reset stored memories. Requires admin role."""
    try:
        get_memory_instance().reset()
    except Exception:
        raise upstream_error()
    webhooks.emit("memories.deleted_all", {"reset": True})
    return {"message": "All memories reset"}


@app.get("/", summary="Redirect to the OpenAPI documentation", include_in_schema=False)
def home():
    """Redirect to the OpenAPI documentation."""
    return RedirectResponse(url="/docs")


# MCP (streamable HTTP) at /mcp, for agents and phone harnesses that speak MCP rather than REST.
if importlib.util.find_spec("mcp") is not None:
    import mcp_server

    mcp_server.mount(app, sys.modules[__name__])
else:
    logging.info("MCP endpoint disabled: install the optional `mcp` package to serve /mcp.")
