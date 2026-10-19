# AGENTS.md

Context for AI coding assistants (Claude Code, Cursor, Copilot, Codex) working in the norn-memory repository.

**norn-memory** is a self-hosted memory layer for AI agents: a FastAPI server with a dashboard and an MCP endpoint, built on the Python SDK in `mem0/`. It is an independent project derived from [Mem0](https://github.com/mem0ai/mem0) (Apache-2.0). There is no shared git history and changes are not merged from or sent back to upstream, so build features here rather than waiting on upstream. Package and import names (`mem0`, `mem0ai`) are kept from the original.
[Repository](https://github.com/nornzach/norn-memory)

This is a polyglot monorepo and **every package sets its own rules**. Read the `AGENTS.md` nearest the files you are editing before running any command. The linters, formatters, test runners, and line lengths genuinely differ per package, and using the wrong one fails CI or produces a diff full of noise.

## Do NOT

- Commit `.env` files, API keys, or credentials.
- Add telemetry, analytics, or any call that sends data to a third-party service. Everything runs on the user's own network.
- Skip pre-commit hooks.
- Use npm or yarn in TypeScript packages. This repo is pnpm-only (Bun in `integrations/opencode-plugin/`).
- Use `require()` in TypeScript. ES module `import` syntax only.
- Mix up linter configs. Root Python is ruff at line length **120**, `cli/python/` is ruff at **100**, `cli/node/` is Biome, `mem0-ts/` is Prettier, `integrations/vercel-ai-sdk/` is ESLint.
- Add Python dependencies to the core `dependencies` list in `pyproject.toml`. Use an optional group.
- Change a public API without updating `docs/` in the same pull request.
- Introduce a new framework or abstraction without discussion. Follow the patterns already in the file you are editing.

## Where to look

| Editing | Read | Toolchain |
|---------|------|-----------|
| `mem0/` | [`mem0/AGENTS.md`](mem0/AGENTS.md) | hatch, ruff 120, pytest |
| `tests/` | [`tests/AGENTS.md`](tests/AGENTS.md) | pytest |
| `mem0-ts/` | [`mem0-ts/AGENTS.md`](mem0-ts/AGENTS.md) | pnpm, tsup, Prettier, jest |
| `cli/python/` | [`cli/python/AGENTS.md`](cli/python/AGENTS.md) | ruff **100**, pytest |
| `cli/node/` | [`cli/node/AGENTS.md`](cli/node/AGENTS.md) | pnpm, tsup, Biome, vitest |
| `integrations/` | [`integrations/AGENTS.md`](integrations/AGENTS.md) | varies per integration |
| `server/` | [`server/AGENTS.md`](server/AGENTS.md) | Docker Compose, FastAPI |
| `docs/` | [`docs/AGENTS.md`](docs/AGENTS.md) | Mintlify |
| `skills/` | [`skills/AGENTS.md`](skills/AGENTS.md) | markdown, size-budgeted |
| `.github/` | `.github/workflows/ci.yml` | GitHub Actions: Python SDK lint and tests |

## Repository map

| Directory | What it is |
|-----------|------------|
| `mem0/` | Core Python SDK (`mem0ai` on PyPI): memory, LLMs, embeddings, vector stores, graphs, rerankers |
| `mem0-ts/` | TypeScript SDK (`mem0ai` on npm): hosted client + OSS memory |
| `cli/python/` | Python CLI (`mem0-cli` on PyPI), Typer-based, entry point `mem0` |
| `cli/node/` | Node CLI (`@mem0/cli` on npm), Commander-based, entry point `mem0` |
| `integrations/` | Agent and editor integrations, one self-contained directory each |
| `server/` | FastAPI REST server for self-hosted Mem0 (Docker: FastAPI + pgvector + Neo4j) |
| `skills/` | Claude Code skill definitions, published by raw URL |
| `docs/` | Documentation site (Mintlify) |
| `tests/` | Python SDK tests (pytest) |
| `examples/` | Sample apps, Chrome extension, multi-agent patterns, notebooks |
| `scripts/` | Repo-wide utilities, e.g. `check-llms-txt-coverage.py` |

```
mem0 (Python SDK)          mem0-ts (TypeScript SDK)
├── mem0/memory/           ├── src/client/    MemoryClient (hosted)
├── mem0/llms/             └── src/oss/       Memory (self-hosted)
├── mem0/embeddings/           ├── src/llms/
├── mem0/vector_stores/        ├── src/embeddings/
├── mem0/graphs/               ├── src/vector_stores/
└── mem0/reranker/             └── src/graphs/

cli/python/                 ──▶ mem0ai (optional, OSS mode)
cli/node/                   ──▶ mem0ai (npm)
integrations/vercel-ai-sdk/ ──▶ ai, @ai-sdk/*
integrations/openclaw/      ──▶ mem0ai (npm)
```

## Setup

```bash
hatch shell dev_py_3_11   # Python: creates the env with all deps
pre-commit install        # ruff + isort on commit

cd <ts-package> && pnpm install
```

Requirements: Python 3.9+ (3.10+ for the CLI), Node 18+ (20 or 22 preferred), pnpm 10+, hatch, Docker for `server/`.

## Conventions everywhere

- **Naming:** `snake_case.py`, `test_<module>.py`, `snake_case.ts`, `<module>.test.ts`, `kebab-case` for config and manifest files.
- **Python:** Pydantic v2 for models and config. Providers inherit a `base.py` abstract class; config lives in `configs.py`.
- **TypeScript:** strict mode, tsup builds, ES module imports.
- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`).
- **Versions:** bump in `pyproject.toml` or `package.json`.
- **Builds:** Docker images are built from the local source. Never pull the SDK or the server from PyPI, npm, or a registry image.

## What to ship with a change

Guidelines, not rules. Trivial fixes need less; anything user-facing needs more.

| Change | Expect |
|--------|--------|
| **Bug fix** | A regression test that fails without the fix, written first. The fix. The relevant suite passing. The package's linter run. |
| **New feature** | Implementation following existing patterns, test coverage, `docs/` updates for public APIs, an example if the behavior is user-facing, and an `llms.txt` entry for any new `.mdx` page. |
| **New provider** | See [Adding a provider](mem0/AGENTS.md#adding-a-provider). |
| **New integration** | See [Adding an integration](integrations/AGENTS.md#adding-an-integration). |
| **Refactor** | Tests for changed behavior, existing tests still green. No docs needed for internal-only changes. |

Fix bugs at the root, not at the symptom. If a guard belongs in a shared function, put it there rather than in each caller.

## Working in this repo

1. Branch from `main` (`feature/...`, `fix/...`).
2. Make the change: code, tests, docs.
3. Run lint and tests for **every** package you touched.
4. Commit with Conventional Commits. Commits use the GitHub no-reply email; a private address is rejected on push.
5. Do not submit work you have not run, and do not write tests that assert the implementation back at itself.

### Reference

| Topic | File |
|-------|------|
| Contributor guide | [`CONTRIBUTING.md`](CONTRIBUTING.md) |
| Security reports | [`SECURITY.md`](SECURITY.md) |
| Self-hosted server | [`server/README.md`](server/README.md) |
| REST and MCP reference | `docs/open-source/features/rest-api.mdx` |
