"""Tests for the self-hosted server's import endpoint.

The server modules import each other as top-level modules (``import webhooks``), so
``server/`` is put on ``sys.path`` here rather than importing them as ``server.*``.
"""

import importlib
import os
import sys
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

pytest.importorskip("fastapi", reason="fastapi not installed")
pytest.importorskip("httpx", reason="httpx not installed")

from fastapi.testclient import TestClient  # noqa: E402

SERVER_DIR = Path(__file__).resolve().parent.parent / "server"
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

TEST_ENV = {
    "JWT_SECRET": "test-secret-for-pytest-only-0123456789",
    "OPENAI_API_KEY": "fake-key",
    "ADMIN_API_KEY": "",
    "AUTH_DISABLED": "false",
    "NORN_M_TELEMETRY": "false",
}


@pytest.fixture(scope="module", autouse=True)
def _server_env():
    with patch.dict(os.environ, TEST_ENV):
        yield


# ---------------------------------------------------------------------------
# POST /import
# ---------------------------------------------------------------------------


@pytest.fixture
def import_client():
    mock_memory = MagicMock()
    mock_memory.add.return_value = {"results": [{"id": "new", "memory": "x", "event": "ADD"}]}
    with patch("norn_m.Memory.from_config", return_value=mock_memory):
        import main

        main = importlib.reload(main)
    from routers import imports

    main.app.dependency_overrides[imports.require_admin] = lambda: None
    existing = [{"user_id": "alice", "agent_id": None, "run_id": None, "memory": "Likes green tea"}]
    with ExitStack() as stack:
        stack.enter_context(patch.object(imports, "get_memory_instance", return_value=mock_memory))
        stack.enter_context(patch.object(imports, "list_memories", return_value=existing))
        emit = stack.enter_context(patch.object(imports.webhooks, "emit_memory_results"))
        yield TestClient(main.app), mock_memory, emit
    main.app.dependency_overrides.clear()


class TestImport:
    def test_stores_verbatim_with_owner_and_categories(self, import_client):
        client, memory, emit = import_client
        body = {
            "memories": [
                {
                    "memory": "Prefers aisle seats",
                    "user_id": "carol",
                    "categories": ["Travel"],
                    "metadata": {"device": "phone"},
                }
            ]
        }

        resp = client.post("/import", json=body)

        assert resp.status_code == 200
        assert resp.json() == {"imported": 1, "skipped": 0, "failed": []}
        kwargs = memory.add.call_args.kwargs
        assert kwargs["infer"] is False
        assert kwargs["user_id"] == "carol"
        assert kwargs["metadata"] == {"device": "phone", "categories": ["Travel"]}
        assert kwargs["messages"] == [{"role": "user", "content": "Prefers aisle seats"}]
        emit.assert_called_once()

    def test_skips_existing_text_for_the_same_owner_only(self, import_client):
        client, memory, _ = import_client
        body = {
            "memories": [
                {"memory": "Likes green tea", "user_id": "alice"},
                {"memory": "Likes green tea", "user_id": "bob"},
            ]
        }

        resp = client.post("/import", json=body)

        assert resp.json()["imported"] == 1
        assert resp.json()["skipped"] == 1
        assert memory.add.call_args.kwargs["user_id"] == "bob"

    def test_duplicates_within_one_file_are_stored_once(self, import_client):
        client, memory, _ = import_client
        item = {"memory": "Runs every morning", "user_id": "carol"}

        resp = client.post("/import", json={"memories": [item, item]})

        assert resp.json()["imported"] == 1
        assert resp.json()["skipped"] == 1
        assert memory.add.call_count == 1

    def test_skip_duplicates_off_imports_everything(self, import_client):
        client, memory, _ = import_client
        body = {"memories": [{"memory": "Likes green tea", "user_id": "alice"}], "skip_duplicates": False}

        resp = client.post("/import", json=body)

        assert resp.json()["imported"] == 1
        memory.add.assert_called_once()

    def test_reports_items_without_owner_or_with_secrets(self, import_client):
        client, memory, _ = import_client
        body = {
            "memories": [
                {"memory": "Nobody owns this"},
                {"memory": "token sk-proj-Zx8vQ2mN7pL4kR9tW3yB6cH1jF5gD0sA", "user_id": "carol"},
                {"memory": "Fine", "user_id": "carol"},
            ]
        }

        resp = client.post("/import", json=body)

        data = resp.json()
        assert data["imported"] == 1
        assert [f["index"] for f in data["failed"]] == [0, 1]
        assert "user_id" in data["failed"][0]["error"]
        memory.add.assert_called_once()

    def test_a_failing_store_is_reported_not_raised(self, import_client):
        client, memory, emit = import_client
        memory.add.side_effect = RuntimeError("vector store down")

        resp = client.post("/import", json={"memories": [{"memory": "Fine", "user_id": "carol"}]})

        assert resp.status_code == 200
        assert resp.json()["failed"] == [{"index": 0, "error": "vector store down"}]
        emit.assert_not_called()

    def test_rejects_more_than_one_batch(self, import_client):
        client, _, _ = import_client
        items = [{"memory": f"m{i}", "user_id": "carol"} for i in range(101)]

        assert client.post("/import", json={"memories": items}).status_code == 422
