"""MCP endpoint (streamable HTTP) at /mcp, so agents that speak MCP share the memory behind the REST API.

Each memory tool is a thin wrapper over a REST handler in main.py, so validation, webhooks and
auto-categorization behave the same on both; the exact_* tools call exact_store.py, as the /exact
routes do. Requests authenticate exactly like the REST
API: X-API-Key (a per-user key or ADMIN_API_KEY) or a Bearer token.

Needs the optional `mcp` package; main.py skips mounting when it is not installed.
"""

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from functools import partial
from types import ModuleType
from typing import Annotated, Any, Optional

import exact_store
import provenance
from auth import api_key_header, bearer_scheme, request_scope, verify_auth
from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from mcp.server.mcpserver import Context, MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations
from memory_store import ALL_MEMORIES_LIMIT
from pydantic import Field
from starlette.concurrency import run_in_threadpool

logger = logging.getLogger(__name__)

MCP_PATH = "/mcp"
# Lets each agent's MCP config pin whose memory it reads and writes, so a tool call that names
# no user_id, agent_id or run_id still lands in the right scope.
DEFAULT_USER_HEADER = "X-Norn-M-User-Id"

INSTRUCTIONS = (
    "Long-term memory shared by every agent and device connected to this Norn-M server. "
    "Call search_memories before answering anything that depends on the user's preferences, history, "
    "projects or earlier decisions. Call add_memory when the user states a durable fact, preference or "
    "decision worth recalling in a later session; skip small talk and one-off details. "
    "Scope every call with the same user_id for the same person (agent_id and run_id narrow it further). "
    "Memories are shared across agents, so write them so another agent can understand them out of context. "
    "Anything that must come back character for character (passwords, API keys, accounts, server IPs and "
    "logins, URLs, IDs, numbers, dates and birthdays) goes in exact records instead: exact_set stores it under "
    "a key such as server/hk1 or site/github.com, exact_get and exact_search return it verbatim. Exact records "
    "are never sent to an LLM. Copy their values exactly; never paraphrase or guess them. "
    "Every write records where it came from. On add_memory and exact_set, pass project (the project or "
    "repository name, e.g. the git repository's folder name) and cwd (your current working directory) "
    "whenever the memory belongs to the work at hand; leave them out for facts about the user in general. "
    "To recall what belongs to one project, device or agent, pass project, device or agent to "
    "search_memories, list_memories or exact_search."
)
# Exact records shown next to fuzzy results in search_memories, so agents find them without a second call.
UNIFIED_EXACT_LIMIT = 3

UserId = Annotated[
    Optional[str],
    Field(description="Whose memories. Use the same stable id for the same person across sessions and agents."),
]
AgentId = Annotated[Optional[str], Field(description="Narrow to memories written by or for one agent.")]
RunId = Annotated[Optional[str], Field(description="Narrow to one conversation or task run.")]
MemoryId = Annotated[str, Field(description="Memory id, as returned by search_memories or list_memories.")]
Project = Annotated[
    Optional[str],
    Field(description="Project or repository name, e.g. the git repository's folder name. Case-insensitive."),
]
Cwd = Annotated[Optional[str], Field(description="Absolute path of your current working directory.")]
ProjectFilter = Annotated[Optional[str], Field(description="Only what was recorded for this project.")]
DeviceFilter = Annotated[
    Optional[str], Field(description='Only what was written from this device, e.g. "mac", "windows", "phone".')
]
AgentFilter = Annotated[
    Optional[str], Field(description='Only what this agent wrote, e.g. "claude-code", "omp", "devin".')
]
CwdFilter = Annotated[Optional[str], Field(description="Only what was written in this folder or one under it.")]
ExactKey = Annotated[
    str,
    Field(
        description=(
            'Record key: a short path such as "server/hk1", "site/github.com", "api/deepseek" or "person/mom". '
            "Case-insensitive; spaces around slashes are ignored."
        )
    ),
]
ExactUserId = Annotated[
    Optional[str],
    Field(description="Whose records. Defaults to the connection's default user."),
]


class _AuthenticatedEndpoint:
    """ASGI endpoint that runs the REST API's auth before handing the request to the MCP session manager."""

    def __init__(self, server: MCPServer) -> None:
        self.server = server

    async def __call__(self, scope, receive, send) -> None:
        request = Request(scope, receive)
        try:
            user = await verify_auth(request, await bearer_scheme(request), await api_key_header(request))
        except HTTPException as exc:
            response = JSONResponse({"detail": exc.detail}, status_code=exc.status_code, headers=exc.headers)
            await response(scope, receive, send)
            return
        # Request state lives in the ASGI scope, so the tools see it through ctx.request_context.request.
        request.state.user = user
        await self.server.session_manager.handle_request(scope, receive, _log_rejections(request, send))


def _log_rejections(request: Request, send):
    """Wrap `send` to log why the MCP transport refused a request (4xx). The access log only shows the
    status; the reason is in the response body. Request bodies and credentials are never logged."""
    status = 0
    body = b""

    async def wrapped(message) -> None:
        nonlocal status, body
        if message["type"] == "http.response.start":
            status = message["status"]
        elif message["type"] == "http.response.body" and 400 <= status < 500 and len(body) < 2048:
            body += message.get("body", b"")
            if not message.get("more_body"):
                logger.warning(
                    "MCP %s %s rejected with %s (protocol version %s): %s",
                    request.method,
                    request.url.path,
                    status,
                    request.headers.get("mcp-protocol-version", "none"),
                    body[:500].decode("utf-8", "replace"),
                )
        await send(message)

    return wrapped


def _request(ctx: Context) -> Request:
    return ctx.request_context.request


def _key_scope(ctx: Context):
    """The calling API key's scope (None for full access); handlers enforce it as they do for REST."""
    return request_scope(_request(ctx))


def _default_user(ctx: Context) -> Optional[str]:
    return _request(ctx).headers.get(DEFAULT_USER_HEADER) or None


async def _call(handler, *args, **kwargs):
    """Run a sync REST handler off the event loop and turn its HTTP errors into tool errors."""
    try:
        return await run_in_threadpool(handler, *args, **kwargs)
    except HTTPException as exc:
        raise ToolError(str(exc.detail)) from exc


def _run_later(tasks: BackgroundTasks) -> None:
    """Start the handler's background work (auto-categorization) without holding up the tool result."""
    loop = asyncio.get_running_loop()
    for task in tasks.tasks:
        loop.run_in_executor(None, partial(task.func, *task.args, **task.kwargs))


def _exact_user(ctx: Context, user_id: Optional[str], *, write: bool) -> str:
    try:
        return exact_store.resolve_user(_key_scope(ctx), user_id or _default_user(ctx), write=write)
    except HTTPException as exc:
        raise ToolError(str(exc.detail)) from exc


async def _matching_exact_records(
    ctx: Context, query: str, user_id: Any, source: dict[str, Optional[str]]
) -> list[dict[str, Any]]:
    """Well-matched exact records for a memory search, under the same project/device/agent/folder
    filters; empty when the caller can't read records."""
    if not isinstance(user_id, str) or not user_id:
        return []
    try:
        uid = exact_store.resolve_user(_key_scope(ctx), user_id, write=False)
        search = partial(exact_store.search_records, uid, query, limit=UNIFIED_EXACT_LIMIT, **source)
        results = await run_in_threadpool(search)
    except HTTPException:
        return []
    except Exception:
        logger.exception("Exact-record lookup for search_memories failed")
        return []
    return [r for r in results if exact_store.well_matched(r)]


def _register_tools(server: MCPServer, api: ModuleType) -> None:
    @server.tool(annotations=ToolAnnotations(title="Search memories", readOnlyHint=True, openWorldHint=False))
    async def search_memories(
        ctx: Context,
        query: Annotated[str, Field(description="What to look for, in natural language.")],
        user_id: UserId = None,
        agent_id: AgentId = None,
        run_id: RunId = None,
        filters: Annotated[
            Optional[dict[str, Any]],
            Field(
                description=(
                    'Advanced metadata filters, e.g. {"categories": {"in": ["Work"]}} or '
                    '{"AND": [...]}. user_id/agent_id/run_id above are merged in.'
                )
            ),
        ] = None,
        top_k: Annotated[int, Field(ge=1, le=100, description="Maximum number of memories to return.")] = 10,
        project: ProjectFilter = None,
        device: DeviceFilter = None,
        agent: AgentFilter = None,
        cwd: CwdFilter = None,
    ) -> dict[str, Any]:
        """Find stored memories relevant to a query, ranked by semantic similarity.

        Use this before answering questions that depend on what you know about the user: preferences,
        past decisions, projects, people, or facts from earlier sessions. Returns memories with their id,
        text, score and metadata, plus up to 3 exact records whose keywords match the query under
        "exact_records" (values verbatim). At least one of user_id, agent_id or run_id is required unless
        the connection sets a default user or the API key is limited to one.
        """
        merged = dict(filters or {})
        merged.update({k: v for k, v in {"user_id": user_id, "agent_id": agent_id, "run_id": run_id}.items() if v})
        if not any(merged.get(k) for k in ("user_id", "agent_id", "run_id")) and _default_user(ctx):
            merged["user_id"] = _default_user(ctx)
        source = {"project": project, "device": device, "agent": agent, "cwd": cwd}
        search = api.SearchRequest(query=query, filters=merged, top_k=top_k, **source)
        response = await _call(api.search_memories, search, scope=_key_scope(ctx))
        exact = await _matching_exact_records(ctx, query, merged.get("user_id"), source)
        if exact and isinstance(response, dict):
            response = {**response, "exact_records": exact}
        return response

    @server.tool(annotations=ToolAnnotations(title="Add memory", destructiveHint=False, openWorldHint=False))
    async def add_memory(
        ctx: Context,
        text: Annotated[
            str,
            Field(description="The fact, preference or decision to remember, or a conversation excerpt to learn from."),
        ],
        user_id: UserId = None,
        agent_id: AgentId = None,
        run_id: RunId = None,
        metadata: Annotated[
            Optional[dict[str, Any]],
            Field(description='Extra fields stored with the memory. Pass {"categories": [...]} to set categories.'),
        ] = None,
        infer: Annotated[
            bool,
            Field(
                description=(
                    "True: an LLM extracts facts and merges them with existing memories (updating or "
                    "replacing outdated ones). False: store the text verbatim."
                )
            ),
        ] = True,
        project: Project = None,
        cwd: Cwd = None,
    ) -> dict[str, Any]:
        """Store something worth remembering in long-term memory, shared with every connected agent.

        Use this when the user states a durable preference, fact about themselves, decision, or project
        detail that should be recalled in a later session. Skip small talk and transient details.
        Passwords, API keys, account logins, IPs and other values that must stay exact go in exact_set
        instead; this tool rejects text that looks like a secret.
        At least one of user_id, agent_id or run_id is required unless the connection sets a default
        user. Pass project and cwd when the memory belongs to the current work, so it can be found by project
        later; the device and agent come from the connection. Returns the resulting memory events (ADD,
        UPDATE, DELETE, NONE).
        """
        if not any([user_id, agent_id, run_id]):
            user_id = _default_user(ctx)
        given = {k: v for k, v in {"project": project, "cwd": cwd}.items() if v}
        memory_create = api.MemoryCreate(
            messages=[api.Message(role="user", content=text)],
            user_id=user_id,
            agent_id=agent_id,
            run_id=run_id,
            metadata={**(metadata or {}), **given} or None,
            infer=infer,
        )
        background_tasks = BackgroundTasks()
        response = await _call(api.add_memory, memory_create, background_tasks, _request(ctx), scope=_key_scope(ctx))
        _run_later(background_tasks)
        return json.loads(response.body)

    @server.tool(annotations=ToolAnnotations(title="Get memory", readOnlyHint=True, openWorldHint=False))
    async def get_memory(ctx: Context, memory_id: MemoryId) -> dict[str, Any]:
        """Fetch one memory by id, with its text, scope, metadata and timestamps."""
        memory = await _call(api.get_memory, memory_id, scope=_key_scope(ctx))
        if not memory:
            raise ToolError(f"Memory {memory_id} not found.")
        return memory

    @server.tool(annotations=ToolAnnotations(title="List memories", readOnlyHint=True, openWorldHint=False))
    async def list_memories(
        ctx: Context,
        user_id: UserId = None,
        agent_id: AgentId = None,
        run_id: RunId = None,
        category: Annotated[
            Optional[str], Field(description='Only return memories tagged with this category, e.g. "Work".')
        ] = None,
        limit: Annotated[
            int, Field(ge=1, le=ALL_MEMORIES_LIMIT, description="Maximum number of memories to return.")
        ] = 100,
        project: ProjectFilter = None,
        device: DeviceFilter = None,
        agent: AgentFilter = None,
        cwd: CwdFilter = None,
    ) -> dict[str, Any]:
        """List stored memories for a user, agent or run, without ranking.

        Use this to review everything known in a scope, or to browse one category or project. To find memories
        about a topic, use search_memories instead. Listing every scope at once (no ids and no default
        user) needs an admin key.
        """
        if not any([user_id, agent_id, run_id]):
            user_id = _default_user(ctx)
        request = _request(ctx)
        return await _call(
            api.get_all_memories,
            request,
            user_id=user_id,
            run_id=run_id,
            agent_id=agent_id,
            category=category,
            device=device,
            agent=agent,
            project=project,
            cwd=cwd,
            top_k=limit,
            show_expired=False,
            _auth=request.state.user,
            scope=request_scope(request),
        )

    @server.tool(annotations=ToolAnnotations(title="Delete memory", destructiveHint=True, openWorldHint=False))
    async def delete_memory(ctx: Context, memory_id: MemoryId) -> dict[str, Any]:
        """Permanently delete one memory by id. Use when the user asks to forget something or a memory is wrong.

        This cannot be undone and affects every agent sharing this memory.
        """
        await _call(api.delete_memory, memory_id, scope=_key_scope(ctx))
        return {"id": memory_id, "deleted": True}

    @server.tool(annotations=ToolAnnotations(title="Save exact record", destructiveHint=False, openWorldHint=False))
    async def exact_set(
        ctx: Context,
        key: ExactKey,
        fields: Annotated[
            Optional[dict[str, Any]],
            Field(
                description=(
                    'The exact values, e.g. {"ip": "203.0.113.7", "user": "root", "password": "..."} or '
                    '{"date": "1990-05-14"}. Stored verbatim. A null value removes that field.'
                )
            ),
        ] = None,
        kind: Annotated[
            Optional[str],
            Field(description=f"What it is: {', '.join(exact_store.SUGGESTED_KINDS)}, or another short slug."),
        ] = None,
        title: Annotated[Optional[str], Field(description='Human-readable name, e.g. "HK1 Docker host".')] = None,
        description: Annotated[
            Optional[str], Field(description="Free-text notes: what it is for, how to use it. Searchable.")
        ] = None,
        tags: Annotated[
            Optional[list[str]], Field(description='Labels for filtering, e.g. ["prod", "docker"].')
        ] = None,
        replace: Annotated[
            bool,
            Field(description="False (default): change only what you pass. True: overwrite the whole record."),
        ] = False,
        if_version: Annotated[
            Optional[int],
            Field(description="Only write if the record is at this version (0: only if it does not exist yet)."),
        ] = None,
        user_id: ExactUserId = None,
        project: Project = None,
        cwd: Cwd = None,
    ) -> dict[str, Any]:
        """Save values that must be recalled exactly, under a fixed key.

        Use for passwords, API keys, tokens, website accounts, server IPs, ports, logins and paths, URLs,
        IDs, numbers, dates and birthdays: anything an agent must later copy character for character.
        Values are stored verbatim in Postgres and never sent to an LLM or embedder. Writing to an existing
        key updates it (the previous version is kept); search with exact_search first so you update the
        existing record instead of creating a near-duplicate key. Returns the record and whether it was
        created, updated or unchanged.
        """
        uid = _exact_user(ctx, user_id, write=True)
        data = _record_write(
            kind=kind, title=title, description=description, tags=tags, fields=fields, project=project, cwd=cwd
        )
        source = provenance.from_request(_request(ctx))
        return await _call(
            exact_store.put_record, uid, key, data, merge=not replace, if_version=if_version, source=source
        )

    @server.tool(annotations=ToolAnnotations(title="Get exact record", readOnlyHint=True, openWorldHint=False))
    async def exact_get(ctx: Context, key: ExactKey, user_id: ExactUserId = None) -> dict[str, Any]:
        """Fetch one exact record by key, with every field verbatim.

        Use when you know the key (from exact_search, a memory that names it, or the user). If the key does
        not exist, the error lists the closest existing keys.
        """
        uid = _exact_user(ctx, user_id, write=False)
        record = await _call(exact_store.get_record, uid, key)
        if record is None:
            close = await _call(exact_store.close_keys, uid, key)
            hint = f" Closest keys: {', '.join(close)}." if close else " Try exact_search."
            raise ToolError(f"No exact record {exact_store.normalize_key(key)}.{hint}")
        return record

    @server.tool(annotations=ToolAnnotations(title="Search exact records", readOnlyHint=True, openWorldHint=False))
    async def exact_search(
        ctx: Context,
        query: Annotated[
            Optional[str],
            Field(
                description=(
                    'Keywords, e.g. "github password", "hk1 ip", "203.0.113.7" or "妈妈 生日". Every term is '
                    "matched as a substring of the key, title, tags, field names and values, and description; "
                    "typos are tolerated. Leave empty to list records by key."
                )
            ),
        ] = None,
        kind: Annotated[Optional[str], Field(description='Only this kind, e.g. "server" or "credential".')] = None,
        tag: Annotated[Optional[str], Field(description="Only records with this tag.")] = None,
        prefix: Annotated[Optional[str], Field(description='Only keys starting with this, e.g. "server/".')] = None,
        limit: Annotated[int, Field(ge=1, le=exact_store.SEARCH_LIMIT, description="Maximum results.")] = 20,
        user_id: ExactUserId = None,
        project: ProjectFilter = None,
        device: DeviceFilter = None,
        agent: AgentFilter = None,
        cwd: CwdFilter = None,
    ) -> dict[str, Any]:
        """Find exact records by keyword, kind, tag, key prefix, project, device, agent or folder. Deterministic: the same query always
        returns the same records in the same order.

        Results are ranked by exact key match, then key prefix, then how many query terms they contain, and
        include every field verbatim plus a "match" block that says why each one matched.
        """
        uid = _exact_user(ctx, user_id, write=False)
        results = await _call(
            exact_store.search_records,
            uid,
            query,
            kind=kind,
            tag=tag,
            prefix=prefix,
            project=project,
            device=device,
            agent=agent,
            cwd=cwd,
            limit=limit,
        )
        return {"results": results}

    @server.tool(annotations=ToolAnnotations(title="Delete exact record", destructiveHint=True, openWorldHint=False))
    async def exact_delete(ctx: Context, key: ExactKey, user_id: ExactUserId = None) -> dict[str, Any]:
        """Delete one exact record by key. Its last state stays in the record's version history."""
        uid = _exact_user(ctx, user_id, write=True)
        if not await _call(exact_store.delete_record, uid, key):
            raise ToolError(f"No exact record {exact_store.normalize_key(key)}.")
        return {"key": exact_store.normalize_key(key), "deleted": True}


def _record_write(**values: Any) -> "exact_store.RecordWrite":
    """Validate tool arguments the way the REST body is validated, with errors as tool errors."""
    try:
        return exact_store.RecordWrite(**values)
    except ValueError as exc:
        raise ToolError(f"Invalid record: {exc}") from exc


def mount(app: FastAPI, api: ModuleType) -> MCPServer:
    """Serve the memory tools at /mcp on `app`. `api` is the module holding the REST handlers (main)."""
    server = MCPServer("norn-m", instructions=INSTRUCTIONS)
    _register_tools(server, api)
    # Creates server.session_manager; the Starlette app it returns is unused, as /mcp is routed below.
    server.streamable_http_app(
        # Stateless JSON responses: any worker can answer any request, and simple clients need no SSE.
        stateless_http=True,
        json_response=True,
        # Auth is the gate here, as on the REST API, and phones reach the server by LAN IP or hostname.
        transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
    )
    app.add_route(MCP_PATH, _AuthenticatedEndpoint(server), include_in_schema=False)

    parent_lifespan = app.router.lifespan_context

    @asynccontextmanager
    async def lifespan(app_):
        async with parent_lifespan(app_) as state, server.session_manager.run():
            yield state

    app.router.lifespan_context = lifespan
    return server
