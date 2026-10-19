"""Tests for provenance: every memory records the device, agent, project, folder and API key it came
from, and memories can be listed, searched and exported by those fields.

Requests go through the real auth check, REST handlers and MCP transport; only the Memory instance,
webhooks and the categorizer are mocked. Exact-record provenance needs Postgres and lives in
test_server_exact.py.
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

from fastapi import HTTPException
from fastapi.testclient import TestClient

SERVER_DIR = Path(__file__).resolve().parent.parent / "server"
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

import provenance  # noqa: E402

TEST_ENV = {
    "JWT_SECRET": "test-secret-for-pytest-only-0123456789",
    "OPENAI_API_KEY": "fake-key",
    "ADMIN_API_KEY": "",
    "AUTH_DISABLED": "false",
}
ADMIN_KEY = "test-admin-key-for-pytest-0123456789"
MCP_HEADERS = {"Accept": "application/json, text/event-stream"}
CONNECTION = {"X-Norn-M-Device": "Mac", "X-Norn-M-Agent": "Claude-Code"}
# Memory ids are UUIDs; the server 404s anything else before it reaches the store.
M1 = "11111111-1111-4111-8111-111111111111"


@pytest.fixture(scope="module", autouse=True)
def _server_env():
    with patch.dict(os.environ, TEST_ENV):
        yield


@pytest.fixture
def server():
    mock_memory = MagicMock()
    mock_memory.add.return_value = {"results": []}
    with patch("norn_m.Memory.from_config", return_value=mock_memory):
        import main

        main = importlib.reload(main)
    import auth

    with ExitStack() as stack:
        stack.enter_context(patch.object(auth, "ADMIN_API_KEY", ADMIN_KEY))
        # Admin-only routes look up the first account; no app database here, so use the bootstrap admin.
        stack.enter_context(patch.object(auth, "_get_default_user", return_value=None))
        stack.enter_context(patch.object(main.webhooks, "emit_memory_results"))
        stack.enter_context(patch.object(main.webhooks, "emit"))
        stack.enter_context(patch.object(main.categorizer, "categorize_memories"))
        stack.enter_context(patch.object(main, "_persist_request_log"))
        stack.enter_context(patch.object(main, "get_memory_instance", return_value=mock_memory))
        import memory_store

        stack.enter_context(patch.object(memory_store, "get_memory_instance", return_value=mock_memory))
        mcp_server = sys.modules.get("mcp_server")
        if mcp_server is not None:
            stack.enter_context(patch.object(mcp_server.exact_store, "search_records", return_value=[]))
        with TestClient(main.app) as client:
            yield SimpleNamespace(client=client, memory=mock_memory, main=main)


def _rest(server, method, path, headers=None, **kwargs):
    return server.client.request(method, path, headers={"X-API-Key": ADMIN_KEY, **(headers or {})}, **kwargs)


def _tool(server, name, arguments, headers=None):
    pytest.importorskip("mcp", reason="mcp not installed")
    body = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": arguments}}
    headers = {**MCP_HEADERS, "X-API-Key": ADMIN_KEY, **(headers or {})}
    resp = server.client.post("/mcp", json=body, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()["result"]


def _memory(id_, **metadata):
    return {"id": id_, "memory": id_, "user_id": "zach", "metadata": metadata}


class TestCleaning:
    def test_grouping_fields_fold_case_and_whitespace(self):
        assert provenance.clean("device", "  Mac  Book ") == "mac book"
        assert provenance.clean("project", "Norn-M") == "norn-m"
        assert provenance.clean("agent", "   ") is None

    def test_folder_keeps_case_and_drops_trailing_slashes(self):
        assert provenance.clean("cwd", "/Users/Zach/Repo//") == "/Users/Zach/Repo"
        assert provenance.clean("cwd", "C:\\Users\\zach\\repo\\") == "C:\\Users\\zach\\repo"
        assert provenance.clean("cwd", "/") == "/"
        assert provenance.clean("cwd", "C:\\") == "C:\\"

    @pytest.mark.parametrize("value", ["a\nb", "x\x00", 42])
    def test_rejects_values_that_cannot_be_stored(self, value):
        with pytest.raises(HTTPException) as exc:
            provenance.clean("project", value)
        assert exc.value.status_code == 400

    def test_rejects_overlong_values(self):
        with pytest.raises(HTTPException):
            provenance.clean("device", "d" * 65)

    def test_folder_test_matches_the_folder_and_below_only(self):
        assert provenance.under("/repo", "/repo")
        assert provenance.under("/repo/server", "/repo")
        assert provenance.under("C:\\repo\\server", "C:\\repo")
        assert not provenance.under("/repo-old", "/repo")
        assert not provenance.under("/old/repo", "/repo")
        assert not provenance.under(None, "/repo")


class TestStamping:
    def test_connection_headers_and_tool_arguments_are_recorded(self, server):
        _tool(
            server,
            "add_memory",
            {"text": "Uses pnpm here", "user_id": "zach", "project": "Norn-M", "cwd": "/home/dev/norn-memory/"},
            headers=CONNECTION,
        )

        assert server.memory.add.call_args.kwargs["metadata"] == {
            "project": "norn-m",
            "cwd": "/home/dev/norn-memory",
            "device": "mac",
            "agent": "claude-code",
            "key_label": "admin",
        }

    def test_a_given_project_wins_over_the_project_header(self, server):
        _tool(
            server,
            "add_memory",
            {"text": "x", "user_id": "zach", "project": "api"},
            headers={"X-Norn-M-Project": "web"},
        )
        assert server.memory.add.call_args.kwargs["metadata"]["project"] == "api"

    def test_project_header_is_the_fallback(self, server):
        _tool(server, "add_memory", {"text": "x", "user_id": "zach"}, headers={"X-Norn-M-Project": "Web"})
        assert server.memory.add.call_args.kwargs["metadata"]["project"] == "web"

    def test_callers_cannot_forge_the_key_label(self, server):
        resp = _rest(
            server,
            "POST",
            "/memories",
            json={
                "messages": [{"role": "user", "content": "x"}],
                "user_id": "zach",
                "metadata": {"key_label": "phone"},
            },
        )
        assert resp.status_code == 200
        assert server.memory.add.call_args.kwargs["metadata"] == {"key_label": "admin"}

    def test_rest_writes_keep_their_own_metadata(self, server):
        resp = _rest(
            server,
            "POST",
            "/memories",
            headers={"X-Norn-M-Device": "Hermes"},
            json={
                "messages": [{"role": "user", "content": "x"}],
                "user_id": "zach",
                "metadata": {"project": "Infra", "topic": "backups"},
            },
        )
        assert resp.status_code == 200
        assert server.memory.add.call_args.kwargs["metadata"] == {
            "project": "infra",
            "topic": "backups",
            "device": "hermes",
            "key_label": "admin",
        }

    def test_rest_top_level_fields_win_over_metadata_and_headers(self, server):
        resp = _rest(
            server,
            "POST",
            "/memories",
            headers={"X-Norn-M-Project": "header", "X-Norn-M-Device": "Mac"},
            json={
                "messages": [{"role": "user", "content": "x"}],
                "user_id": "zach",
                "project": "Top",
                "cwd": "/repo/",
                "metadata": {"project": "meta"},
            },
        )
        assert resp.status_code == 200
        kwargs = server.memory.add.call_args.kwargs
        assert kwargs["metadata"] == {"project": "top", "cwd": "/repo", "device": "mac", "key_label": "admin"}
        # Provenance travels in metadata only; the SDK's add() takes no such arguments.
        assert not set(kwargs) & {"project", "cwd", "device", "agent"}

    def test_an_update_can_fix_the_project_but_not_the_key_label(self, server):
        server.memory.update.return_value = {"message": "Memory updated successfully!"}

        resp = _rest(
            server, "PUT", f"/memories/{M1}", json={"metadata": {"project": " Norn-M ", "key_label": "forged", "x": 1}}
        )

        assert resp.status_code == 200
        assert server.memory.update.call_args.kwargs["metadata"] == {"project": "norn-m", "x": 1}

    def test_bad_values_are_rejected_before_anything_is_stored(self, server):
        result = _tool(server, "add_memory", {"text": "x", "user_id": "zach", "project": "a\nb"})
        assert result["isError"] is True
        server.memory.add.assert_not_called()


class TestLookup:
    def test_search_narrows_in_the_vector_store_then_keeps_only_the_folder(self, server):
        server.memory.search.return_value = {
            "results": [
                _memory("inside", project="norn-m", device="mac", cwd="/repo/server"),
                _memory("lookalike", project="norn-m", device="mac", cwd="/old/repo"),
                _memory("exact", project="norn-m", device="mac", cwd="/repo"),
            ]
        }

        result = _tool(
            server,
            "search_memories",
            {"query": "build", "user_id": "zach", "project": "Norn-M", "device": "mac", "cwd": "/repo"},
        )

        filters = server.memory.search.call_args.kwargs["filters"]
        assert filters == {"user_id": "zach", "project": "norn-m", "device": "mac", "cwd": {"contains": "/repo"}}
        assert [m["id"] for m in result["structuredContent"]["results"]] == ["inside", "exact"]

    def test_rest_listing_for_a_user_filters_by_project(self, server):
        server.memory.get_all.return_value = {"results": [_memory("m1", project="norn-m")]}

        resp = _rest(server, "GET", "/memories", params={"user_id": "zach", "project": "NORN-M", "agent": "omp"})

        assert resp.status_code == 200
        assert server.memory.get_all.call_args.kwargs["filters"] == {
            "user_id": "zach",
            "project": "norn-m",
            "agent": "omp",
        }

    def test_admin_listing_filters_the_scan(self, server):
        rows = [
            SimpleNamespace(id="a", payload={"data": "a", "user_id": "zach", "project": "norn-m", "device": "mac"}),
            SimpleNamespace(id="b", payload={"data": "b", "user_id": "zach", "project": "norn-m", "device": "phone"}),
            SimpleNamespace(id="c", payload={"data": "c", "user_id": "zach", "project": "web", "device": "mac"}),
        ]
        server.memory.vector_store.list.return_value = [rows]

        resp = _rest(server, "GET", "/memories", params={"project": "norn-m", "device": "mac"})

        assert resp.status_code == 200
        assert [m["id"] for m in resp.json()["results"]] == ["a"]
        assert resp.json()["results"][0]["metadata"] == {"project": "norn-m", "device": "mac"}

    def test_list_tool_passes_the_filters_through(self, server):
        server.memory.get_all.return_value = {"results": []}

        _tool(server, "list_memories", {"user_id": "zach", "project": "norn-m", "device": "windows"})

        assert server.memory.get_all.call_args.kwargs["filters"] == {
            "user_id": "zach",
            "project": "norn-m",
            "device": "windows",
        }

    def test_export_filters_and_adds_provenance_columns(self, server):
        rows = [
            SimpleNamespace(
                id="a", payload={"data": "a", "user_id": "zach", "project": "norn-m", "agent": "omp", "key_label": "k1"}
            ),
            SimpleNamespace(id="b", payload={"data": "b", "user_id": "zach", "project": "web"}),
        ]
        server.memory.vector_store.list.return_value = [rows]

        resp = _rest(server, "GET", "/export", params={"format": "csv", "project": "norn-m"})

        assert resp.status_code == 200
        header, row = resp.text.strip().splitlines()
        assert header.split(",")[6:11] == ["device", "agent", "project", "cwd", "key_label"]
        assert row.split(",")[6:11] == ["", "omp", "norn-m", "", "k1"]
