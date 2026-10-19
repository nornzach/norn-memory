"""Tests that bad input to the memory endpoints comes back as a 4xx, not as a 502 "upstream" error.

Requests go through the real auth check and REST handlers; only the Memory instance, webhooks and the
categorizer are mocked.
"""

import importlib
import os
import sys
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

pytest.importorskip("fastapi", reason="fastapi not installed")
pytest.importorskip("httpx", reason="httpx not installed")

from fastapi.testclient import TestClient

SERVER_DIR = Path(__file__).resolve().parent.parent / "server"
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

TEST_ENV = {
    "JWT_SECRET": "test-secret-for-pytest-only-0123456789",
    "OPENAI_API_KEY": "fake-key",
    "ADMIN_API_KEY": "",
    "AUTH_DISABLED": "false",
}
ADMIN_KEY = "test-admin-key-for-pytest-0123456789"
MEMORY_ID = "3f1c2a9e-5b7d-4e8f-9a0b-1c2d3e4f5a6b"
WHITESPACE_ERROR = ValueError("Invalid user_id: cannot contain whitespace. Provide a valid identifier without spaces.")


@pytest.fixture(scope="module", autouse=True)
def _server_env():
    with patch.dict(os.environ, TEST_ENV):
        yield


@pytest.fixture
def server():
    mock_memory = MagicMock()
    with patch("norn_m.Memory.from_config", return_value=mock_memory):
        import main

        main = importlib.reload(main)
    import auth

    with ExitStack() as stack:
        stack.enter_context(patch.object(auth, "ADMIN_API_KEY", ADMIN_KEY))
        stack.enter_context(patch.object(auth, "_get_default_user", return_value=None))
        stack.enter_context(patch.object(main.webhooks, "emit"))
        stack.enter_context(patch.object(main.categorizer, "categorize_memories"))
        stack.enter_context(patch.object(main, "_persist_request_log"))
        stack.enter_context(patch.object(main, "get_memory_instance", return_value=mock_memory))
        with TestClient(main.app) as client:
            yield SimpleNamespace(client=client, memory=mock_memory)


def _rest(server, method, path, **kwargs):
    return server.client.request(method, path, headers={"X-API-Key": ADMIN_KEY}, **kwargs)


class TestMemoryIds:
    def test_an_unknown_id_is_a_404(self, server):
        server.memory.get.return_value = None
        resp = _rest(server, "GET", f"/memories/{MEMORY_ID}")
        assert resp.status_code == 404

    def test_a_known_id_returns_the_memory(self, server):
        server.memory.get.return_value = {"id": MEMORY_ID, "memory": "x"}
        resp = _rest(server, "GET", f"/memories/{MEMORY_ID}")
        assert resp.status_code == 200
        assert resp.json()["id"] == MEMORY_ID

    @pytest.mark.parametrize("method", ["GET", "PUT", "DELETE"])
    def test_an_id_that_is_not_a_uuid_is_a_404_without_touching_the_store(self, server, method):
        kwargs = {"json": {"text": "x"}} if method == "PUT" else {}
        resp = _rest(server, method, "/memories/not-a-uuid", **kwargs)
        assert resp.status_code == 404
        server.memory.get.assert_not_called()
        server.memory.update.assert_not_called()
        server.memory.delete.assert_not_called()


class TestEntityIds:
    def test_listing_with_an_invalid_user_id_is_a_400(self, server):
        server.memory.get_all.side_effect = WHITESPACE_ERROR
        resp = _rest(server, "GET", "/memories", params={"user_id": "x' OR '1'='1"})
        assert resp.status_code == 400
        assert "whitespace" in resp.json()["detail"]

    def test_deleting_all_for_an_invalid_user_id_is_a_400(self, server):
        server.memory.delete_all.side_effect = WHITESPACE_ERROR
        resp = _rest(server, "DELETE", "/memories", params={"user_id": "a b"})
        assert resp.status_code == 400

    def test_a_provider_failure_while_listing_is_still_a_502(self, server):
        server.memory.get_all.side_effect = RuntimeError("database went away")
        resp = _rest(server, "GET", "/memories", params={"user_id": "alice"})
        assert resp.status_code == 502
