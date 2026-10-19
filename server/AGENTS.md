# Server (`server/`)

FastAPI server with the REST API and the MCP endpoint (`mcp_server.py`), Alembic migrations for the app database, and the Next.js dashboard in `dashboard/`. Docker only.

## Commands

```bash
make up                 # docker compose up -d --build
make bootstrap          # up + first admin + first API key
make logs
make down               # stop; `make clean` also deletes the data volume
```

| Service | Port |
|---|---|
| Norn-M API | 8888 |
| Dashboard | 3000 (`DASHBOARD_PORT`) |
| PostgreSQL (pgvector) | 8432 |

The compose project is `norn-m-dev`. The dev image mounts `server/` and `../norn_m/`, so Python edits reload without a rebuild; dashboard changes need `docker compose up -d --build norn-m-dashboard`.

## Conventions

- **Python:** ruff, line length 120. Server modules import each other as top-level modules (`import auth`), not as a package.
- **Migrations:** schema changes get a new file in `alembic/versions/`, numbered after the last one. Never edit an applied migration.
- **Dashboard:** pnpm only, Prettier, ESLint, `pnpm exec tsc --noEmit -p .` for types. UI strings live in `src/i18n/messages/` with `en` and `zh` side by side; a missing Chinese key fails the build.
- **Auth:** every route depends on `verify_auth` / `get_key_scope`; scoped keys must not reach admin routes.
- The server imports the library from the repo, so its conventions apply to any library code you touch: see [`../norn_m/AGENTS.md`](../norn_m/AGENTS.md).

Never commit `.env`. Credentials for the compose services belong in `.env.example` as placeholders only.
