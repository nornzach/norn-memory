# Memory library (`norn_m/`)

The `norn-m` Python package: memory core plus pluggable LLM, embedder, vector-store and reranker providers. The server in `../server/` runs it.

## Commands

```bash
hatch shell dev_py_3_11   # or dev_py_3_10 / dev_py_3_12
pre-commit install        # first time only; runs ruff + isort on commit

make lint                 # ruff check
make format               # ruff format
make sort                 # isort norn_m/
make test                 # pytest tests/
make install_all          # optional deps; run before the full test suite
```

Use `hatch` for environments and dependencies.

## Conventions

- **Python 3.10 through 3.12.**
- **Ruff**, line length **120**.
- **isort**, `profile = "black"`, first-party `norn_m`.
- **Pydantic v2** for every data model and config class.
- **pytest** with pytest-mock and pytest-asyncio. Tests live in `../tests/`.

## Layout

```
norn_m/
├── memory/          Memory, AsyncMemory, history storage
├── configs/         MemoryConfig and per-category config models
├── llms/            LLM providers
├── embeddings/      embedding providers
├── vector_stores/   vector-store providers
├── reranker/        rerankers
└── utils/           factories, entity extraction, scoring
```

The server image bundles a subset of providers (see `BUNDLED_*_PROVIDERS` in `server/main.py`); the rest need their optional dependency group.

## Adding a provider

1. Create `norn_m/<category>/<provider_name>.py`, inheriting the abstract class in `norn_m/<category>/base.py`.
2. Add its config model under `norn_m/configs/` if the category uses one, and register it in the category's factory in `norn_m/utils/factory.py`.
3. Add tests under `tests/<category>/`.
4. Put new dependencies in an **optional** group in `pyproject.toml`, never in core `dependencies`.
5. Match an existing provider in the same category: method signatures, error handling, config structure.

## Public API

| Class | Import |
|---|---|
| `Memory`, `AsyncMemory` | `from norn_m import Memory, AsyncMemory` |
| `MemoryConfig` | `from norn_m.configs.base import MemoryConfig` |

| Method | Purpose |
|---|---|
| `add(messages, *, user_id, agent_id, run_id, metadata, infer)` | Store memories |
| `search(query, *, filters, top_k)` | Search memories |
| `get(memory_id)` | Fetch one memory |
| `get_all(*, filters, top_k)` | List memories |
| `update(memory_id, data)` | Update a memory |
| `delete(memory_id)` | Delete a memory |
| `delete_all(*, user_id, agent_id, run_id)` | Delete a scope |
| `history(memory_id)` | Change history for a memory |

The library sends nothing anywhere on its own; `tests/memory/test_no_phone_home.py` guards that.
