# REST and MCP API

The Norn-M server exposes every memory operation over HTTP, plus an MCP endpoint for agents. Paths have no version prefix: it is `POST /memories`, not `POST /v1/memories`. The interactive OpenAPI explorer is at `/docs` (`http://localhost:8888/docs` with Docker Compose).

Enable authentication and put the server behind HTTPS before exposing it beyond your own network.

- [Authentication](#authentication)
- [Memories](#memories)
- [Search filters](#search-filters)
- [MCP for agents](#mcp-for-agents)
- [Provenance](#provenance)
- [Exact records](#exact-records)
- [Endpoint reference](#endpoint-reference)

## Authentication

Auth is on by default. Protected endpoints take either a JWT from the dashboard login or an `X-API-Key` header. The `/` redirect, `/docs` and `/openapi.json` stay open.

| Mode | How to send it | Use it for |
|---|---|---|
| Bearer JWT | `Authorization: Bearer <access_token>` | Dashboard sessions. Tokens come from `POST /auth/login` and refresh through `POST /auth/refresh` |
| Per-user API key | `X-API-Key: nmsk_...` | Agents, scripts and devices, tied to one dashboard user |
| `ADMIN_API_KEY` | `X-API-Key: <env value>` | A shared admin key set in the environment, not tied to a user |
| `AUTH_DISABLED=true` | none | Local development only: every endpoint is open |

In the `/docs` explorer, click **Authorize** and paste `Bearer <access_token>` or your API key.

### Log in and use a JWT

Register the first admin (only works while no user exists), then log in:

```bash
curl -X POST http://localhost:8888/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name": "Admin", "email": "admin@example.com", "password": "strong-password"}'

curl -X POST http://localhost:8888/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@example.com", "password": "strong-password"}'
```

Send the returned `access_token` as a bearer token, and exchange the refresh token at `POST /auth/refresh` when it expires.

### Create and use an API key

Create a key on the dashboard's **API Keys** page, or with `POST /api-keys` and a JWT. Its owner can show the full `nmsk_...` value again at any time (the dashboard's eye button, or `GET /api-keys/{id}/key`). The server checks requests against a bcrypt hash and keeps a copy encrypted with a key derived from `JWT_SECRET` only for showing it; keys created before copies were kept, or before `JWT_SECRET` last changed, still work but can't be shown again (`retrievable: false` in the list).

```bash
curl -X POST http://localhost:8888/memories \
  -H "Content-Type: application/json" \
  -H "X-API-Key: nmsk_your_key_here" \
  -d '{"messages": [{"role": "user", "content": "I love pizza."}], "user_id": "alice"}'
```

A key acts with its creator's role. List and revoke keys with `GET /api-keys` and `DELETE /api-keys/{id}`.

### Scope an API key

A key without scopes can read and write every memory. Give each device or agent its own scoped key instead, in the **API Keys** dialog or in the `POST /api-keys` body:

```bash
curl -X POST http://localhost:8888/api-keys \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"label": "Pixel phone", "access": "read_write", "user_ids": ["alice"], "agent_ids": ["phone-assistant"]}'
```

| Field | Meaning |
|---|---|
| `access` | `read_write` (default) or `read`. Read-only keys can search, list, get and export, but not add, update or delete |
| `user_ids`, `agent_ids`, `run_ids` | The key sees only memories whose `user_id` / `agent_id` / `run_id` is in the list. An empty list means any value. Lists combine with AND |
| `categories` | The key sees only memories tagged with at least one of these categories |

How a scoped key behaves:

- **Reads are filtered.** `GET /memories`, `POST /search`, `GET /entities` and `GET /export` return only memories in scope. An ID outside the scope returns `403`; a single memory outside it returns `404`.
- **A single allowed value is filled in.** If a key allows exactly one `user_id`, requests without `user_id` use it.
- **Writes stay inside the scope.** `POST /memories` must name an allowed value for every restricted field. `PUT` and `DELETE` only reach memories in scope.
- **Category-limited keys must tag their writes** with allowed `metadata.categories` and use `"infer": false`.
- **Admin endpoints are closed.** Scoped keys get `403` from `/api-keys`, `/auth/*`, `/configure`, `/generate-instructions`, `/reset`, `DELETE /memories`, `/requests`, `/categories`, `/webhooks` and `/analytics`, so a scoped key cannot mint an unscoped one.

Scopes cannot be edited: create a new key and revoke the old one.

### Keep secrets out of fuzzy memory

Memory text goes through the configured LLM, which may rewrite or drop it. `POST /memories` and `PUT /memories/{id}` therefore reject text or metadata that looks like a credential (provider API keys, bearer tokens, JWTs, private keys, passwords in URLs, `password=` assignments, long high-entropy tokens) with a `400` that points to [exact records](#exact-records). The error names the field and the kind of secret, never the value. Set `NORN_M_ALLOW_SECRETS=true` to turn the check off.

## Memories

```bash
curl -X POST http://localhost:8888/memories \
  -H "Content-Type: application/json" -H "X-API-Key: nmsk_your_key_here" \
  -d '{"messages": [{"role": "user", "content": "I love fresh vegetable pizza."}], "user_id": "alice"}'

curl -X POST http://localhost:8888/search \
  -H "Content-Type: application/json" -H "X-API-Key: nmsk_your_key_here" \
  -d '{"query": "vegetable", "user_id": "alice"}'
```

Adding returns the new memory IDs and their events (`ADD`). Every memory belongs to at least one of `user_id`, `agent_id` or `run_id`. Set `"infer": false` to store the text as given instead of letting the LLM extract facts from it. On search, `"explain": true` adds `score_details` with the hybrid-search signals for each result.

## Search filters

`POST /search` and `GET /memories` filter by `user_id`, `agent_id`, `run_id`, plus `category` and the [provenance](#provenance) fields `project`, `device`, `agent` and `cwd`. `POST /search` also takes a `filters` object over memory metadata:

```json
{"query": "deploy", "user_id": "alice", "filters": {"categories": {"in": ["Work"]}}}
```

Operators: `eq`, `ne`, `in`, `nin`, `gt`, `gte`, `lt`, `lte`, `contains`, `icontains`, and `AND` / `OR` / `NOT` to combine conditions.

## MCP for agents

The server speaks the [Model Context Protocol](https://modelcontextprotocol.io) at `/mcp` over streamable HTTP, so Claude Code and other MCP-capable agents share one memory without a custom client. It authenticates exactly like the REST API, and a scoped key keeps its limits. See [Connecting agents](agents.md) for setup. The memory hook script that setup installs is served, without authentication, at `GET /agent-hooks/norn_m_hook.py`.

| Tool | Arguments | REST equivalent |
|---|---|---|
| `search_memories` | `query`, `user_id` / `agent_id` / `run_id`, `filters`, `top_k`, `project` / `device` / `agent` / `cwd` | `POST /search` |
| `add_memory` | `text`, `user_id` / `agent_id` / `run_id`, `metadata`, `infer`, `project`, `cwd` | `POST /memories` |
| `get_memory` | `memory_id` | `GET /memories/{memory_id}` |
| `list_memories` | `user_id` / `agent_id` / `run_id`, `category`, `limit`, `project` / `device` / `agent` / `cwd` | `GET /memories` |
| `delete_memory` | `memory_id` | `DELETE /memories/{memory_id}` |
| `exact_set` | `key`, `fields`, `kind`, `title`, `description`, `tags`, `replace`, `if_version`, `user_id`, `project`, `cwd` | `PUT /exact/records/{key}` (merge by default) |
| `exact_get` | `key`, `user_id` | `GET /exact/records/{key}` |
| `exact_search` | `query`, `kind`, `tag`, `prefix`, `limit`, `user_id`, `project` / `device` / `agent` / `cwd` | `GET /exact/records` |
| `exact_delete` | `key`, `user_id` | `DELETE /exact/records/{key}` |

Each tool calls the same handler as its REST route, so validation, webhooks and categorization behave the same. Errors come back as MCP tool errors with the REST message. `search_memories` also returns up to three exact records that match at least two thirds of the query's keywords, under `exact_records`.

The `X-Norn-M-User-Id` header sets a default user: when a tool call names no `user_id`, `agent_id` or `run_id`, it is scoped to that user, so every agent configured with the same value shares the same memories.

Check the endpoint without a client:

```bash
curl -X POST http://localhost:8888/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "X-API-Key: nmsk_your_key_here" \
  -d '{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}'
```

The endpoint is stateless and answers with plain JSON, so it works behind a load balancer without session affinity.

## Provenance

Every memory and exact record stores where it came from, so you can list, search and export by project, device or agent:

| Field | Set by | Example |
|---|---|---|
| `device` | The `X-Norn-M-Device` header, once per agent config | `mac`, `windows`, `phone`, `web` |
| `agent` | The `X-Norn-M-Agent` header, once per agent config | `claude-code`, `omp`, `devin` |
| `project` | The agent, per write (`project` argument); `X-Norn-M-Project` is a fallback | `norn-memory` |
| `cwd` | The agent, per write (`cwd` argument); `X-Norn-M-Cwd` is a fallback | `/Users/alice/code/norn-memory` |
| `key_label` | The server: the label of the API key that made the write. Callers cannot set it | `laptop` |

`device`, `agent` and `project` are stored lowercase, so `Mac` and `mac` group together. Memories keep these fields in `metadata`, not in `agent_id`: `agent_id` is a scope API keys can be limited to, while provenance only labels a memory's origin. Editing a memory keeps its provenance. An exact record keeps each field from the last change that supplied it, and its history keeps earlier values.

Filter with the same names on `GET /memories`, `POST /search`, `GET /export`, `GET /exact/records` and the matching MCP tools. `cwd` matches that folder and everything under it.

## Exact records

An LLM sits between what you write to fuzzy memory and what is stored. Values that must come back character for character (passwords, API keys, logins, server IPs, URLs, IDs, birthdays) go in **exact records**:

- **Verbatim.** A record is a key plus typed fields, stored in Postgres exactly as sent. Nothing in it goes to an LLM or embedder.
- **Keyed.** Keys are short paths such as `server/hk1`, `site/github.com` or `person/mom`. They are case-insensitive, spaces around `/` are ignored, and each `user_id` has its own keys.
- **Deterministic search.** `GET /exact/records?q=...` matches every keyword as a substring of the key, title, tags, field names and values, and description (CJK text by two-character pieces), tolerates typos through trigram similarity, and always ranks the same way. Each result has a `match` block saying why it matched.
- **Versioned.** Every update and delete keeps the previous state; `GET /exact/history/{key}` returns it.
- **Plaintext.** Values are not encrypted at rest. Run the server on a network you trust.

```bash
curl -X PUT http://localhost:8888/exact/records/server/hk1 \
  -H "X-API-Key: nmsk_your_key_here" -H "X-Norn-M-User-Id: alice" -H "Content-Type: application/json" \
  -d '{"kind": "server", "title": "HK1 Docker host", "tags": ["prod"],
       "fields": {"ip": "203.0.113.7", "user": "root", "compose_dir": "/opt/stack"}}'

curl "http://localhost:8888/exact/records?q=hk1%20ip" -H "X-API-Key: nmsk_your_key_here" -H "X-Norn-M-User-Id: alice"
```

`PUT` replaces the record unless the body sets `"merge": true`, which changes only the fields given and removes fields set to `null`. `"if_version": N` writes only if the record is still at version `N` (`0` means "only if it does not exist"). `POST /exact/batch` writes up to 1000 records in one transaction.

The user comes from `user_id` (query or body) or the `X-Norn-M-User-Id` header. A key limited by `user_id` alone can use its users' records; a key limited to agents, runs or categories cannot use exact records.

## Endpoint reference

### Memories

| Method | Path | Description |
|---|---|---|
| `POST` | `/configure` | Set the memory configuration. Rejects unbundled providers, and an embedder whose vectors don't fit the vector store |
| `POST` | `/configure/test` | Admin only. Send one request to the LLM and one to the embedder as configured by the body, without saving |
| `GET` | `/configure` | Current memory configuration |
| `GET` | `/configure/providers` | LLM and embedder providers bundled in the image |
| `POST` | `/memories` | Create memories. `expiration_date` (`YYYY-MM-DD`) hides them after that day |
| `GET` | `/memories` | List memories, filtered by `user_id`, `agent_id`, `run_id`, `category`, `project`, `device`, `agent` or `cwd`. Expired memories are left out unless `show_expired=true` |
| `GET` | `/memories/{memory_id}` | Get one memory |
| `PUT` | `/memories/{memory_id}` | Update a memory's `text`, `metadata` or `expiration_date` (`null` clears it) |
| `DELETE` | `/memories/{memory_id}` | Delete a memory |
| `DELETE` | `/memories` | Delete all memories for an identifier |
| `GET` | `/memories/{memory_id}/history` | A memory's change history |
| `POST` | `/search` | Search memories. `show_expired: true` includes expired ones |
| `POST` | `/reset` | Delete every memory |

### Accounts and keys

| Method | Path | Description |
|---|---|---|
| `GET` | `/auth/setup-status` | `{needsSetup: bool}`. Open |
| `POST` | `/auth/register` | Register the first admin. Closed once an admin exists |
| `POST` | `/auth/login` | Exchange email and password for access and refresh JWTs |
| `POST` | `/auth/refresh` | Exchange a refresh token for a new access token |
| `GET` / `PATCH` | `/auth/me` | Get or update the current user, including `last_login_at` |
| `POST` | `/auth/change-password` | Change the caller's password |
| `POST` | `/auth/logout` | Revoke one refresh token: `{"refresh_token": "..."}` |
| `GET` | `/auth/sessions` | `{active: n}`, the refresh tokens that can still be used (one per signed-in browser) |
| `POST` | `/auth/sign-out-others` | Revoke every refresh token except the one in the body; returns `{signed_out: n}`. Other browsers keep their access token until it expires (30 minutes) |
| `GET` | `/api-keys` | List the caller's API keys |
| `POST` | `/api-keys` | Create a key, optionally scoped; returns the full `nmsk_...` value |
| `PUT` | `/api-keys/{id}` | Change a key's `label`, `access` and scope (the same fields as creating one). The secret stays the same |
| `GET` | `/api-keys/{id}/key` | The full key, for the user who created it. `409` when it can't be shown again (see `retrievable`) |
| `DELETE` | `/api-keys/{id}` | Revoke a key |
| `GET` | `/requests?limit=N&key=Laptop` | Recent calls made with an API key (dashboard browsing isn't logged). Each entry has `key_label`: the label the key had at the time, `admin` for `ADMIN_API_KEY`, or `null` for calls logged before keys were recorded and calls with a key that didn't work. `key` filters to one label |

### Entities

| Method | Path | Description |
|---|---|---|
| `GET` | `/entities` | Distinct `user_id` / `agent_id` / `run_id` values with memory counts |
| `DELETE` | `/entities/{entity_type}/{entity_id}` | Delete every memory of an entity; `entity_type` is `user`, `agent` or `run` |

### Categories

Admin only. The server tags each new or updated memory in the background: the configured LLM picks up to three of your categories using their descriptions. Pass `metadata.categories` on `POST /memories` to set them yourself.

| Method | Path | Description |
|---|---|---|
| `GET` | `/categories` | Categories with memory counts |
| `POST` | `/categories` | Create: `{"name": "Health", "description": "..."}` |
| `PATCH` | `/categories/{id}` | Rename or re-describe; a rename updates tagged memories |
| `DELETE` | `/categories/{id}` | Delete and remove from tagged memories |
| `POST` | `/categories/backfill?retag_all=false` | Tag untagged memories in the background, up to 500 per call. `retag_all=true` re-tags every memory, replacing their categories |

### Webhooks

Admin only.

| Method | Path | Description |
|---|---|---|
| `GET` | `/webhooks` | Webhooks with their last delivery status |
| `POST` | `/webhooks` | Create: `{"url": "...", "events": [...]}`. The `whsec_...` signing secret is returned once |
| `PATCH` | `/webhooks/{id}` | Change `url`, `events` or `is_active` |
| `DELETE` | `/webhooks/{id}` | Delete |
| `POST` | `/webhooks/{id}/test` | Send a signed `ping` now |

Events: `memory.created`, `memory.updated`, `memory.deleted` and `memories.deleted_all`. Each delivery is a JSON `POST` of `{"event", "data", "timestamp"}` with a 5-second timeout and no retries. Verify it by computing HMAC-SHA256 of the raw body with the signing secret and comparing it to the `X-Norn-M-Signature` header:

```python
import hashlib, hmac

def is_valid(secret: str, body: bytes, header: str) -> bool:
    expected = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header)
```

The server runs in Docker: to reach a receiver on the host, use `http://host.docker.internal:<port>`.

### Consolidation

Admin only. Adding memories never edits old ones, so restated and outdated facts pile up. A consolidation run finds memories in the same user/agent/run scope whose embeddings are at least `threshold` similar, asks the LLM about each group and stores proposals. Nothing changes until you apply one: `merge` rewrites the oldest memory with the combined text and deletes the rest; `supersede` deletes the outdated ones.

| Method | Path | Description |
|---|---|---|
| `POST` | `/consolidation/runs` | Start a run: `{"user_id": "alice", "threshold": 0.8}` |
| `GET` | `/consolidation/runs` | Recent runs |
| `GET` | `/consolidation/runs/{id}` | A run and its proposals |
| `POST` | `/consolidation/runs/{id}/apply` | Apply every pending proposal of a run |
| `DELETE` | `/consolidation/runs/{id}` | Delete a run |
| `POST` | `/consolidation/proposals/{id}/apply` | Apply one proposal |
| `POST` | `/consolidation/proposals/{id}/dismiss` | Dismiss one proposal |

### Exact records

Any API key, within its scope. `{key}` may contain `/`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/exact/records` | Search with `q`, filter by `kind`, `tag`, key `prefix`, `project`, `device`, `agent` or `cwd`; `limit` (max 200) and `offset` |
| `GET` | `/exact/records/{key}` | Get one record |
| `PUT` | `/exact/records/{key}` | Create (201) or update (200). 409 on a version conflict |
| `DELETE` | `/exact/records/{key}` | Delete; the last state stays in history |
| `GET` | `/exact/history/{key}` | The record and its earlier versions |
| `POST` | `/exact/batch` | Up to 1000 records in one transaction |
| `GET` | `/exact/export?user_id=` | Admin only. Every user's records, or one user's, with values, as a JSON download: `{exported_at, count, exact_records: [...]}`. Each record carries its `user_id`; send each user's records back through `POST /exact/batch` to restore them |

### Analytics, export and import

Admin only.

| Method | Path | Description |
|---|---|---|
| `GET` | `/analytics?range=7d` | Request totals, success rate, latency, requests over time, per-endpoint breakdown, memories per category. `range` is `24h`, `7d` or `30d` |
| `GET` | `/export?format=json` | Download memories as `json` or `csv`, filtered like `GET /memories` |
| `POST` | `/import` | Store up to 100 memories from the `memories` array of a JSON export, verbatim (`infer=false`) with their owner, categories and metadata. `skip_duplicates` (default `true`) skips text that already exists for the same owner. Returns `{imported, skipped, failed: [{index, error}]}` |
