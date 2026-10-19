"""Tests for the self-hosted server's MCP endpoint (streamable HTTP at /mcp).

Requests go through the real auth check and JSON-RPC transport; only the Memory instance,
webhooks and the categorizer are mocked. As in test_server_features.py, ``server/`` is put on
``sys.path`` because the server modules import each other as top-level modules.
"""

import importlib
import os
import sys
import threading
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

pytest.importorskip("fastapi", reason="fastapi not installed")
pytest.importorskip("httpx", reason="httpx not installed")
pytest.importorskip("mcp", reason="mcp not installed")

from fastapi.testclient import TestClient

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
ADMIN_KEY = "test-admin-key-for-pytest-0123456789"
MCP_HEADERS = {"Accept": "application/json, text/event-stream"}
# Memory ids are UUIDs; the server 404s anything else before it reaches the store.
M1 = "11111111-1111-4111-8111-111111111111"


@pytest.fixture(scope="module", autouse=True)
def _server_env():
    with patch.dict(os.environ, TEST_ENV):
        yield


@pytest.fixture
def mcp_client():
    mock_memory = MagicMock()
    with patch("norn_m.Memory.from_config", return_value=mock_memory):
        import main

        main = importlib.reload(main)
    import auth
    import mcp_server

    with ExitStack() as stack:
        stack.enter_context(patch.object(auth, "ADMIN_API_KEY", ADMIN_KEY))
        mocks = SimpleNamespace(
            memory=mock_memory,
            emit_results=stack.enter_context(patch.object(main.webhooks, "emit_memory_results")),
            emit=stack.enter_context(patch.object(main.webhooks, "emit")),
            categorize=stack.enter_context(patch.object(main.categorizer, "categorize_memories")),
            list_all=stack.enter_context(patch.object(main, "list_memories")),
        )
        stack.enter_context(patch.object(main, "_persist_request_log"))
        stack.enter_context(patch.object(main, "get_memory_instance", return_value=mock_memory))
        # search_memories also looks up exact records, which live in Postgres (see test_server_exact.py).
        stack.enter_context(patch.object(mcp_server.exact_store, "search_records", return_value=[]))
        # The context manager runs the app lifespan, which starts the MCP session manager.
        with TestClient(main.app) as client:
            yield client, mocks


def _rpc(client, method, params=None, headers=None):
    body = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}}
    return client.post("/mcp", json=body, headers={**MCP_HEADERS, "X-API-Key": ADMIN_KEY, **(headers or {})})


def _call_tool(client, name, arguments, headers=None):
    resp = _rpc(client, "tools/call", {"name": name, "arguments": arguments}, headers)
    assert resp.status_code == 200, resp.text
    return resp.json()["result"]


def _error_text(result):
    assert result["isError"] is True
    return result["content"][0]["text"]


class TestMcpProtocol:
    def test_initialize_reports_server_and_usage_instructions(self, mcp_client):
        client, _ = mcp_client

        resp = _rpc(
            client,
            "initialize",
            {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "pytest", "version": "1"}},
        )

        assert resp.status_code == 200
        result = resp.json()["result"]
        assert result["serverInfo"]["name"] == "norn-m"
        assert "search_memories" in result["instructions"]

    def test_lists_the_memory_tools_with_descriptions_and_hints(self, mcp_client):
        client, _ = mcp_client

        tools = {t["name"]: t for t in _rpc(client, "tools/list").json()["result"]["tools"]}

        assert set(tools) == {
            "search_memories",
            "add_memory",
            "get_memory",
            "list_memories",
            "delete_memory",
            "exact_set",
            "exact_get",
            "exact_search",
            "exact_delete",
        }
        assert all(t["description"].strip() for t in tools.values())
        assert tools["search_memories"]["inputSchema"]["required"] == ["query"]
        assert "description" in tools["search_memories"]["inputSchema"]["properties"]["user_id"]
        assert tools["search_memories"]["annotations"]["readOnlyHint"] is True
        assert tools["delete_memory"]["annotations"]["destructiveHint"] is True


class TestMcpAuth:
    def test_missing_credentials_are_rejected(self, mcp_client):
        client, _ = mcp_client

        resp = client.post(
            "/mcp",
            json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
            headers=MCP_HEADERS,
        )

        assert resp.status_code == 401
        assert resp.headers["WWW-Authenticate"] == "Bearer"

    def test_invalid_bearer_token_is_rejected(self, mcp_client):
        client, mocks = mcp_client

        resp = client.post(
            "/mcp",
            json={"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "get_memory"}},
            headers={**MCP_HEADERS, "Authorization": "Bearer not-a-jwt"},
        )

        assert resp.status_code == 401
        mocks.memory.get.assert_not_called()

    def test_api_key_scopes_apply_to_tools(self, mcp_client):
        import mcp_server
        from scopes import KeyScope

        client, mocks = mcp_client

        async def read_only_key(request, *_):
            request.state.key_scope = KeyScope.build(access="read")

        with patch.object(mcp_server, "verify_auth", read_only_key):
            result = _call_tool(client, "add_memory", {"text": "I like green tea", "user_id": "alice"})

        assert "read-only" in _error_text(result)
        mocks.memory.add.assert_not_called()


class TestSearchMemories:
    def test_scope_is_merged_into_filters(self, mcp_client):
        client, mocks = mcp_client
        mocks.memory.search.return_value = {"results": [{"id": M1, "memory": "Likes green tea", "score": 0.9}]}

        result = _call_tool(
            client,
            "search_memories",
            {"query": "tea", "user_id": "alice", "filters": {"categories": {"in": ["Preferences"]}}, "top_k": 3},
        )

        assert result["isError"] is False
        assert result["structuredContent"] == mocks.memory.search.return_value
        mocks.memory.search.assert_called_once_with(
            query="tea", filters={"categories": {"in": ["Preferences"]}, "user_id": "alice"}, top_k=3
        )

    def test_default_user_header_scopes_an_unscoped_call(self, mcp_client):
        client, mocks = mcp_client
        mocks.memory.search.return_value = {"results": []}

        _call_tool(client, "search_memories", {"query": "tea"}, headers={"X-Norn-M-User-Id": "bob"})

        assert mocks.memory.search.call_args.kwargs["filters"] == {"user_id": "bob"}

    def test_explicit_scope_wins_over_the_default_user(self, mcp_client):
        client, mocks = mcp_client
        mocks.memory.search.return_value = {"results": []}

        _call_tool(client, "search_memories", {"query": "tea", "agent_id": "hermes"}, {"X-Norn-M-User-Id": "bob"})

        assert mocks.memory.search.call_args.kwargs["filters"] == {"agent_id": "hermes"}

    def test_upstream_failure_is_a_tool_error_not_a_crash(self, mcp_client):
        client, mocks = mcp_client
        mocks.memory.search.side_effect = RuntimeError("vector store down")

        result = _call_tool(client, "search_memories", {"query": "tea", "user_id": "alice"})

        assert _error_text(result)


class TestAddMemory:
    def test_goes_through_the_rest_handler(self, mcp_client):
        client, mocks = mcp_client
        categorized = threading.Event()
        mocks.categorize.side_effect = lambda *_: categorized.set()
        mocks.memory.add.return_value = {"results": [{"id": M1, "memory": "Likes green tea", "event": "ADD"}]}

        result = _call_tool(
            client,
            "add_memory",
            {"text": "I like green tea", "user_id": "alice", "agent_id": "claude-code", "infer": False},
        )

        assert result["structuredContent"] == mocks.memory.add.return_value
        mocks.memory.add.assert_called_once_with(
            messages=[{"role": "user", "content": "I like green tea"}],
            user_id="alice",
            agent_id="claude-code",
            infer=False,
            # The admin key wrote it; the connection sent no device or agent headers.
            metadata={"key_label": "admin"},
        )
        assert mocks.emit_results.call_args.args[1] == {"user_id": "alice", "agent_id": "claude-code"}
        assert categorized.wait(5)
        mocks.categorize.assert_called_once_with([(M1, "Likes green tea")])

    def test_default_user_header_scopes_an_unscoped_add(self, mcp_client):
        client, mocks = mcp_client
        mocks.memory.add.return_value = {"results": []}

        _call_tool(client, "add_memory", {"text": "I like green tea"}, headers={"X-Norn-M-User-Id": "bob"})

        assert mocks.memory.add.call_args.kwargs["user_id"] == "bob"

    def test_unscoped_add_is_a_tool_error(self, mcp_client):
        client, mocks = mcp_client

        result = _call_tool(client, "add_memory", {"text": "I like green tea"})

        assert "At least one identifier" in _error_text(result)
        mocks.memory.add.assert_not_called()


class TestGetListDelete:
    def test_get_memory(self, mcp_client):
        client, mocks = mcp_client
        mocks.memory.get.return_value = {"id": M1, "memory": "Likes green tea", "user_id": "alice"}

        result = _call_tool(client, "get_memory", {"memory_id": M1})

        assert result["structuredContent"] == mocks.memory.get.return_value
        mocks.memory.get.assert_called_once_with(M1)

    def test_missing_memory_is_a_tool_error(self, mcp_client):
        client, mocks = mcp_client
        mocks.memory.get.return_value = None

        assert "not found" in _error_text(_call_tool(client, "get_memory", {"memory_id": "nope"}))

    def test_list_memories_filters_by_category(self, mcp_client):
        client, mocks = mcp_client
        mocks.memory.get_all.return_value = {
            "results": [
                {"id": M1, "memory": "Ships on Fridays", "metadata": {"categories": ["Work"]}},
                {"id": "m2", "memory": "Likes green tea", "metadata": {"categories": ["Preferences"]}},
            ]
        }

        result = _call_tool(client, "list_memories", {"user_id": "alice", "category": "Work"})

        assert [m["id"] for m in result["structuredContent"]["results"]] == [M1]
        mocks.memory.get_all.assert_called_once_with(filters={"user_id": "alice"}, top_k=100, show_expired=False)

    def test_listing_every_scope_needs_an_admin(self, mcp_client):
        import mcp_server

        client, mocks = mcp_client
        member = SimpleNamespace(role="member")
        with patch.object(mcp_server, "verify_auth", AsyncMock(return_value=member)):
            result = _call_tool(client, "list_memories", {})

        assert "Admin role required" in _error_text(result)
        mocks.list_all.assert_not_called()

    def test_admin_can_list_every_scope(self, mcp_client):
        client, mocks = mcp_client
        mocks.list_all.return_value = [{"id": M1}]

        result = _call_tool(client, "list_memories", {"limit": 5})

        assert result["structuredContent"] == {"results": [{"id": M1}]}
        mocks.list_all.assert_called_once_with(5, category=None, source={})

    def test_delete_memory_emits_the_webhook(self, mcp_client):
        client, mocks = mcp_client

        result = _call_tool(client, "delete_memory", {"memory_id": M1})

        assert result["structuredContent"] == {"id": M1, "deleted": True}
        mocks.memory.delete.assert_called_once_with(memory_id=M1)
        mocks.emit.assert_called_once_with("memory.deleted", {"id": M1})
