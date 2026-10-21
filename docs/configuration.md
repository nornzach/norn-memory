# Configuration

The server reads `server/.env`. Copy `server/.env.example` and fill in at least `POSTGRES_PASSWORD`, `JWT_SECRET` and the API key for your LLM provider.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | With the default providers | Key for the default LLM and embedder. Use `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `DEEPSEEK_API_KEY` or `DASHSCOPE_API_KEY` (Qwen) when you switch providers |
| `NORN_M_DEFAULT_LLM_PROVIDER` / `NORN_M_DEFAULT_LLM_MODEL` | No | Startup LLM. Defaults to `openai` / `gpt-5-mini` |
| `NORN_M_DEFAULT_EMBEDDER_PROVIDER` / `NORN_M_DEFAULT_EMBEDDER_MODEL` | No | Startup embedder. Defaults to `openai` / `text-embedding-3-small` |
| `NORN_M_DEFAULT_EMBEDDER_DIMS` | No | Embedding width, used for the pgvector column. Defaults to `1536`; `768` for Gemini. Qwen sends it as the requested size (256 to 2560 for `qwen3.7-text-embedding`). Changing it after memories exist needs a new `POSTGRES_COLLECTION_NAME` |
| `JWT_SECRET` | Yes | Signs dashboard tokens. Generate one with `openssl rand -base64 48` |
| `POSTGRES_PASSWORD` | Yes | Password for the bundled Postgres. Compose refuses to start without it |
| `POSTGRES_HOST` / `POSTGRES_PORT` / `POSTGRES_DB` / `POSTGRES_USER` | No | Postgres connection for memories. Default to the bundled container |
| `POSTGRES_COLLECTION_NAME` | No | Table that holds memory vectors. Defaults to `memories` |
| `APP_DB_NAME` | No | Database for users, API keys, settings, exact records and logs. Defaults to `norn_m_app` |
| `ADMIN_API_KEY` | No | A shared admin key, not tied to a user. Prefer per-user keys |
| `AUTH_DISABLED` | No | `true` turns auth off. Local development only |
| `DASHBOARD_PORT` | No | Host port for the dashboard. Defaults to `3000` |
| `DASHBOARD_URL` | No | Origin the API accepts for CORS. Set it when the dashboard runs on another host or port |
| `NORN_M_ALLOW_SECRETS` | No | `true` turns off the check that keeps credentials out of fuzzy memory |
| `REQUEST_LOG_RETENTION_DAYS` | No | Days of request logs `make prune-logs` keeps. Defaults to `30` |

The dashboard reads `server/dashboard/.env`: `NEXT_PUBLIC_API_URL` (the API as the browser reaches it), `API_INTERNAL_URL` (the API as the dashboard container reaches it) and `NEXT_PUBLIC_INSTANCE_NAME` (the name in the sidebar).

## Providers

The image bundles these providers:

| | Providers |
|---|---|
| LLM | `openai`, `anthropic`, `gemini`, `deepseek` |
| Embedder | `openai`, `gemini`, `qwen` |

Any OpenAI-compatible endpoint (a local model server, a proxy, another vendor) works through the `openai` provider with a custom base URL.

`qwen` is Qwen (Qianwen / Alibaba Cloud DashScope) through its OpenAI-compatible endpoint, `https://maas.qianwenaiapi.com/compatible-mode/v1`. It defaults to `qwen3.7-text-embedding`; `text-embedding-v4` works too. Set `DASHSCOPE_BASE_URL` (or `qwen_base_url` in the embedder config) for another DashScope region. Requests carry at most 10 texts, so larger batches are split.

Change providers at runtime on the dashboard's **Configuration** page, which tests the connection before saving. Saved settings persist in the app database, reapply on restart, and take precedence over the defaults from `.env`. The same is available through `POST /configure` (see [the API](api.md#memories)).

## No telemetry

The server and the library it runs send nothing off the machine: no analytics, no remote configuration, no install IDs. The only outbound calls are the ones you configure: your LLM and embedder endpoints, and your webhooks. Docker images are built from this repository's source, never pulled from a package registry.
