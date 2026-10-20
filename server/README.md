# Running the Norn-M server

The server is a FastAPI app with a Next.js dashboard and Postgres (pgvector), run with Docker Compose. It is secure by default, supports dashboard login and API keys, and exposes OpenAPI docs at `/docs`.

## Quick Start

### Prerequisites

Copy the example env file and set a Postgres password (required):

```bash
cd server
cp .env.example .env
# Edit .env — at minimum set POSTGRES_PASSWORD and OPENAI_API_KEY
```

### Agent-first

Run one command; the terminal prints the admin email, password, and first API key.

```bash
cd server
make bootstrap
```

This starts the stack, waits for the API and dashboard to be ready, creates the first admin, and generates the first API key.

> The generated credentials print once in the `=== Ready ===` block. Save the password before closing the terminal. The API key can be shown again on the dashboard's API Keys page.

> `make bootstrap` skips the setup wizard, so the use-case → custom-instructions step doesn't run. To add custom instructions afterwards, `POST /configure` with `{"custom_instructions": "..."}`, or run the Browser-first flow on a fresh install.

You can override the generated credentials:

```bash
cd server
make bootstrap EMAIL=admin@company.com PASSWORD='strong-password' NAME='Admin'
```

For machine-readable output:

```bash
cd server
OUTPUT=json make seed
```

Teardown:

```bash
# Stop the stack
cd server && make down

# Wipe all data (including the Postgres volume)
cd server && make clean
```

### Browser-first

Start the stack and finish setup by walking through the wizard in your browser.

```bash
cd server
make up
```

Then open `http://localhost:3000` and complete the setup wizard.

## Security Defaults

- Dashboard login uses JWTs.
- Programmatic access uses `X-API-Key`.
- Auth is enabled by default.
- `AUTH_DISABLED=true` exists for local development only and should not be used in production.

## Forgotten password

Reset an admin password from the host while the stack is running:

```bash
cd server
make reset-admin-password EMAIL=admin@example.com PASSWORD='new-strong-password'
```

This is the supported recovery path. Anyone with shell access to the host already has full access to the database and secrets, so this command does not expand the attack surface.

## Request log retention

The `request_logs` table is append-only and grows with traffic (~864k rows/day at 10 req/s). Prune it periodically:

```bash
cd server
make prune-logs                               # defaults to 30 days
make prune-logs REQUEST_LOG_RETENTION_DAYS=7  # shorter window
```

Wire the command into cron or a systemd timer in production. The `created_at` column uses a BRIN index, so range deletes stay cheap even on large tables.

## Local URLs

- Dashboard: `http://localhost:3000`
- API: `http://localhost:8888`
- OpenAPI docs: `http://localhost:8888/docs`

## Dashboard

Once logged in, the dashboard exposes:

- **Requests** — live audit log of API calls (method, path, status, latency).
- **Memories** — browse memories as cards or a list, filter by user, agent, category or source (project, device, agent, folder), and edit a memory's text, categories and expiry date. Expired memories are hidden until you switch on "Show expired".
- **Entities** — list every `user_id`, `agent_id`, and `run_id` that owns memories, with counts. Delete an entity to cascade-delete its memories.
- **API Keys** — create, rename, re-scope, and revoke per-user keys.
- **Categories** — define categories; the configured LLM tags new memories with them automatically. Tag older memories, or re-tag all of them after changing the categories.
- **Consolidation** — the LLM proposes merging near-duplicate memories and removing outdated ones; you review and apply.
- **Webhooks** — signed HTTP callbacks when memories are created, updated, or deleted.
- **Analytics** — request volume, success rate, latency, and memories per category.
- **Export & import** — download memories as JSON or CSV, filtered by user, agent, or category, and import a JSON export back, from this server or another. Admins can also back up and restore exact records, values included.
- **Configuration** — runtime LLM and embedder override, including any OpenAI-compatible endpoint (base URL, model, API key), with a connection test, and the custom instructions that steer what gets remembered. Changes persist to the app database and reapply on restart, layered over the values from your `.env`.
- **Settings** — your profile (name, email, last sign-in), password, signed-in browsers (sign out the others), theme and language, and deleting every memory.

## No telemetry

The server and the SDK it runs send nothing off the machine: no analytics, no remote notice config, no install IDs. The only outbound calls are the ones you configure — your LLM and embedder endpoints, and your webhooks. Both images install the SDK from this repository rather than from PyPI.

## Security headers

The dashboard sets the following response headers on every path (see `server/dashboard/next.config.mjs`):

- `X-Frame-Options: DENY`
- `Content-Security-Policy: frame-ancestors 'none'`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`

Together these prevent iframe embedding, sniffing of mislabelled MIME types, and cross-origin referrer leaks. Harden further behind your own reverse proxy if needed.

## Backup and restore

Postgres holds everything: memories (`POSTGRES_DB`, default `postgres`) and users, keys, settings and exact records (`APP_DB_NAME`, default `norn_m_app`).

```bash
cd server
docker compose exec -T postgres pg_dumpall -U postgres > norn_m_backup.sql
```

To restore into a fresh install, start **only** Postgres, restore, then start the rest. The API runs migrations on startup, and restoring after that fails on existing tables.

```bash
docker compose up -d postgres
docker compose exec -T postgres psql -U postgres < norn_m_backup.sql
docker compose up -d
```

## Reference

- [REST and MCP API](../docs/api.md)
- [Configuration](../docs/configuration.md)
- [Connecting agents](../docs/agents.md)
