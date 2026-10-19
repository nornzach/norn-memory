# Tests (`tests/`)

pytest suite for the `norn_m/` library and the server.

## Commands

```bash
make install_all    # optional deps; several tests need them
make test           # pytest tests/

pytest tests/llms/test_openai.py::test_generate_response   # single test
```

Server tests (`test_server_*.py`) put `server/` on `sys.path` and need the server's requirements. The exact-record tests need Postgres: set `NORN_M_TEST_POSTGRES_URL` to a scratch database, or they are skipped.

## Conventions

- Files are named `test_<module>.py`; provider tests mirror the source tree.
- pytest-mock for mocks, pytest-asyncio for the async surface.
- Ruff line length **120**.
- Mock the provider SDK, never the code under test.
- Bug fixes need a regression test that fails without the fix. Write it first and watch it fail.
