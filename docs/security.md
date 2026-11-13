# Security model

This page records what the code actually enforces, so a deployment can be checked against it.
Only the parts that exist are listed; there is no separate "security module".

## Authentication

Two mechanisms, both resolved by `server/auth.py:verify_auth`:

| Caller | Credential | Resolved as |
|---|---|---|
| Dashboard user | `Authorization: Bearer <jwt>` from `/auth/login` (access token, refreshed via `/api/auth/refresh`) | `User` with a role |
| Agent / CLI | `X-API-Key` or `Authorization: Bearer <api key>` | API-key record with a `KeyScope` |

Passwords are bcrypt-hashed (`hash_password`), sessions are JWT access tokens plus single-use refresh
tokens tracked in `refresh_token_jtis`. Login and register are rate limited (`5/minute`, `10/minute`).

## Scopes

`scopes.KeyScope` limits an API key to `user_ids`, `agent_ids`, `run_ids`, `categories` and read-only
access. `None` means "no limit" and only happens for a dashboard session or an unscoped/admin key.

Reads apply the scope in the query itself (`memory_store._conditions`), not afterwards, so a scoped key
cannot receive rows outside its ids even by guessing them. `GET /memories` without any id is refused
unless the caller is an admin (or the key itself is scoped).

## The hierarchy endpoint

`GET /memories/hierarchy-stats` is authenticated with `Depends(get_key_scope)` like every other memory
route, then:

- with `user_id` / `agent_id` / `run_id`, the ids and the caller's scope both filter the two aggregate
  queries, so an out-of-scope id simply yields empty totals rather than another owner's numbers;
- without ids, the view spans every owner and therefore requires an admin role (same rule as listing
  all memories);
- expired memories are excluded, matching the default listing.

The aggregation is two `GROUP BY` queries; it never materializes the table, so the endpoint can't be
used to exhaust server memory.

## Deployment checks (verified on the running host)

| Check | Expected |
|---|---|
| `ss -ltn` shows API and dashboard only on `127.0.0.1` | yes (`127.0.0.1:8888`, `127.0.0.1:30001`) |
| Postgres is not published | yes (no host port) |
| Public entry is Caddy + TLS on `memory.nornnet.com` | yes |
| `Strict-Transport-Security`, `X-Content-Type-Options: nosniff` | sent |
| `server/.env` mode | `600` |
| No keys or tokens committed | `git grep` for `sk-`, `cfat_`, `nmsk_` finds nothing |

## Tests that pin this down

- `server/tests/test_server_hierarchy.py` — 401/403/200 matrix for the hierarchy endpoint.
- `tests/test_server_scopes.py`, `tests/test_server_auth.py` — scope and auth behaviour of the wider API.
- `tests/test_server_memory_paging.py` — the SQL listing and hierarchy aggregates match the Python scan.

Run the server tests with `cd server && python -m pytest tests`.
