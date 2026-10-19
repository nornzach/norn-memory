# Contributing to Norn-M

## Setup

```bash
hatch shell dev_py_3_11      # Python environment with all optional deps
pre-commit install           # ruff + isort on commit
cd server/dashboard && pnpm install
```

Run the stack with `cd server && make up`. See [`server/README.md`](server/README.md).

## Making a change

1. Branch from `main` (`feature/...`, `fix/...`).
2. Make the change with tests, and update `docs/` for anything user-facing.
3. Run lint and tests for every package you touched:
   - Library and server: `make lint` and `make test` from the repository root.
   - Dashboard: `pnpm exec prettier --check src`, `pnpm exec tsc --noEmit -p .` and `pnpm exec eslint src` in `server/dashboard`.
4. Commit with [Conventional Commits](https://www.conventionalcommits.org/).
5. Open a pull request against `main` and fill in the template.

Bug fixes come with a regression test that fails without the fix. Do not submit work you have not run.

## Reporting bugs

Open an issue at [nornzach/norn-memory](https://github.com/nornzach/norn-memory/issues) with the steps to reproduce, what you expected, and what happened. For security issues, see [SECURITY.md](SECURITY.md).
