# AGENTS.md

Context for AI coding assistants working in the Norn-M repository.

**Norn-M** is self-hosted, long-term memory for AI agents: a FastAPI server with a REST API, an MCP endpoint and a Next.js dashboard, built on the memory library in `norn_m/`. Apache-2.0; derived from Mem0 (see `NOTICE`). It is developed independently: there is no upstream to merge from or contribute back to.

Every package sets its own rules. Read the `AGENTS.md` nearest the files you are editing before running any command.

## Do NOT

- Commit `.env` files, API keys or credentials.
- Add telemetry, analytics, or any call that sends data to a third-party service. Everything runs on the user's own network.
- Pull the library or server from a package registry in Docker builds. Images build from this repository's source.
- Use npm or yarn in the dashboard. It is pnpm-only.
- Use `require()` in TypeScript. ES module `import` only.
- Add Python dependencies to the core `dependencies` list in `pyproject.toml`. Use an optional group.
- Change the REST API, MCP tools or headers without updating `docs/` in the same change.
- Introduce a new framework or abstraction without discussion. Follow the patterns already in the file you are editing.

## Where to look

| Editing | Read | Toolchain |
|---|---|---|
| `norn_m/` | [`norn_m/AGENTS.md`](norn_m/AGENTS.md) | hatch, ruff 120, pytest |
| `tests/` | [`tests/AGENTS.md`](tests/AGENTS.md) | pytest |
| `server/` | [`server/AGENTS.md`](server/AGENTS.md) | Docker Compose, FastAPI, Alembic |
| `server/dashboard/` | [`server/AGENTS.md`](server/AGENTS.md) | pnpm, Next.js, Prettier, ESLint |
| `docs/` | this file | Markdown |
| `.github/` | `.github/workflows/ci.yml` | GitHub Actions: library lint and tests |

## Names

| Thing | Name |
|---|---|
| Product | Norn-M |
| Python package / distribution | `norn_m` / `norn-m` |
| Environment variables | `NORN_M_*` |
| HTTP headers | `X-Norn-M-User-Id`, `X-Norn-M-Device`, `X-Norn-M-Agent`, `X-Norn-M-Project`, `X-Norn-M-Cwd`, `X-Norn-M-Signature` |
| MCP server name | `norn-m` |
| API key prefix | `nmsk_` |
| App database | `norn_m_app` |

## Conventions

- **Naming:** `snake_case.py`, `test_<module>.py`, kebab-case `.tsx` component files, kebab-case config files.
- **Python:** Pydantic v2 for models and config. Providers inherit a `base.py` abstract class.
- **TypeScript:** strict mode, ES module imports.
- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`). Use the GitHub no-reply email; a private address is rejected on push.

## What to ship with a change

| Change | Expect |
|---|---|
| **Bug fix** | A regression test that fails without the fix, written first. The fix. The relevant suite passing. The package's linter run |
| **New feature** | Implementation following existing patterns, tests, and `docs/` updates for anything user-facing |
| **Server schema change** | A new Alembic migration in `server/alembic/versions/`; never edit an applied one |
| **Refactor** | Tests for changed behavior; existing tests still green |

Fix bugs at the root, not at the symptom. Do not submit work you have not run, and do not write tests that assert the implementation back at itself.
