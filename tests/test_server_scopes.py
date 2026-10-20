"""Tests for the self-hosted server's scoped API keys and secret guard.

Like test_server_features.py, ``server/`` is put on ``sys.path`` so its modules import each
other as top-level modules.
"""

import asyncio
import importlib
import os
import secrets
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

TEST_ENV = {
    "JWT_SECRET": "test-secret-for-pytest-only-0123456789",
    "OPENAI_API_KEY": "fake-key",
    "ADMIN_API_KEY": "",
    "AUTH_DISABLED": "false",
    "NORN_M_TELEMETRY": "false",
    "NORN_M_ALLOW_SECRETS": "",
}
# Memory ids are UUIDs; the server 404s anything else before it reaches the store.
M1 = "11111111-1111-4111-8111-111111111111"


@pytest.fixture(scope="module", autouse=True)
def _server_env():
    with patch.dict(os.environ, TEST_ENV):
        yield


def _scope(**kwargs):
    from scopes import KeyScope

    return KeyScope.build(**kwargs)


def _mem(id, user_id=None, agent_id=None, run_id=None, categories=None):
    item = {"id": id, "memory": f"memory {id}", "user_id": user_id, "agent_id": agent_id, "run_id": run_id}
    if categories:
        item["metadata"] = {"categories": categories}
    return item


# Built at runtime so no credential-shaped literal sits in the repo.
def _openai_key():
    return "sk-proj-" + secrets.token_urlsafe(32)


def _random_token():
    return secrets.token_urlsafe(32)


# ---------------------------------------------------------------------------
# KeyScope
# ---------------------------------------------------------------------------


class TestKeyScope:
    def test_no_settings_means_full_access(self):
        assert _scope() is None
        assert _scope(access="read_write", user_ids=[], categories=[]) is None

    def test_read_only_alone_is_a_restriction(self):
        scope = _scope(access="read")
        assert scope.read_only and not scope.restricts_entities
        assert scope.allows(_mem(M1, user_id="anyone"))

    def test_allowlists_are_anded_across_fields(self):
        scope = _scope(user_ids=["phone"], agent_ids=["claude", "codex"])
        assert scope.allows(_mem(M1, user_id="phone", agent_id="codex"))
        assert not scope.allows(_mem("m2", user_id="phone", agent_id="other"))
        assert not scope.allows(_mem("m3", user_id="laptop", agent_id="claude"))
        assert not scope.allows(_mem("m4", agent_id="claude"))

    def test_categories_match_any_of_the_memorys_categories(self):
        scope = _scope(categories=["Ops"])
        assert scope.allows(_mem(M1, categories=["Travel", "Ops"]))
        assert scope.allows({"id": "raw", "categories": ["Ops"]})
        assert not scope.allows(_mem("m2", categories=["Travel"]))
        assert not scope.allows(_mem("m3"))

    def test_check_ids_rejects_values_outside_the_allowlist(self):
        scope = _scope(user_ids=["phone"])
        scope.check_ids({"user_id": "phone"})
        scope.check_ids({"agent_id": "x"})
        with pytest.raises(HTTPException) as exc:
            scope.check_ids({"user_id": "laptop"})
        assert exc.value.status_code == 403
        with pytest.raises(HTTPException):
            scope.check_ids({"user_id": {"in": ["phone", "laptop"]}})

    def test_writes_must_name_every_restricted_field(self):
        scope = _scope(user_ids=["phone"])
        with pytest.raises(HTTPException) as exc:
            scope.check_ids({"agent_id": "x"}, required=True)
        assert exc.value.status_code == 403

    def test_single_allowed_value_is_filled_in(self):
        scope = _scope(user_ids=["phone"], agent_ids=["a", "b"])
        assert scope.default_ids({}) == {"user_id": "phone"}
        assert scope.default_ids({"user_id": "x"}) == {"user_id": "x"}

    def test_filter_response_drops_out_of_scope_results_and_unpinned_relations(self):
        scope = _scope(user_ids=["phone"], agent_ids=["a"])
        response = {"results": [_mem("in", "phone", "a"), _mem("out", "phone", "b")], "relations": [{"r": 1}]}

        pinned = scope.filter_response(response, {"user_id": "phone", "agent_id": "a"})
        unpinned = scope.filter_response(response, {"user_id": "phone"})

        assert [m["id"] for m in pinned["results"]] == ["in"]
        assert pinned["relations"] == [{"r": 1}]
        assert unpinned["relations"] == []
        assert scope.filter_response([_mem("out", "laptop")], {}) == []


# ---------------------------------------------------------------------------
# Secret guard
# ---------------------------------------------------------------------------


class TestFindSecrets:
    def _find(self, text):
        import secret_guard

        return secret_guard.find_secrets(text)

    @pytest.mark.parametrize(
        "make_text,label",
        [
            (lambda: f"export OPENAI_API_KEY={_openai_key()}", "OpenAI-style API key"),
            (lambda: "sk-ant-" + "api03-" + secrets.token_urlsafe(30), "Anthropic API key"),
            (lambda: "AIza" + secrets.token_urlsafe(30)[:35].ljust(35, "x"), "Google API key"),
            (
                lambda: "AKIA" + "".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ2345") for _ in range(16)),
                "AWS access key",
            ),
            (lambda: "ghp_" + secrets.token_hex(18), "GitHub token"),
            (lambda: "-----BEGIN OPENSSH " + "PRIVATE KEY-----\nb3BlbnNzaC1rZXk=", "private key"),
            (lambda: "Authorization: Bearer " + secrets.token_hex(20), "bearer token"),
            (lambda: "postgres://norn_m:" + secrets.token_hex(6) + "@db:5432/norn_m", "password in a URL"),
            (lambda: "password=" + secrets.token_hex(6), "credential assignment"),
            (lambda: "the deploy token is " + _random_token(), "high-entropy token"),
            (lambda: "key file: /srv/keys/" + _random_token() + "/id", "high-entropy token"),
        ],
    )
    def test_detects_credentials(self, make_text, label):
        assert label in self._find(make_text())

    @pytest.mark.parametrize(
        "text",
        [
            "The staging DB password is in the team vault under staging/db",
            "deployed commit 3f2a9c1b7e4d5a6f8b9c0d1e2f3a4b5c6d7e8f90 to prod",
            "memory id 0b6f1c1e-3f7a-4d1c-9a43-6a1f2b3c4d5e",
            "config lives at /usr/local/lib/python3.11/site-packages/norn_m/configs/base.py",
            # Absolute paths mix cases, digits and separators; their folder names are judged one by one.
            "/private/tmp/claude-502/-Users-zach-AiProject-mem0/4525b857-1da0-455b-b8f9-4230498b9c0b/scratchpad/ui",
            "worked in /Users/zach/AiProject/norn-memory/server/dashboard/src/components/self-hosted",
            "call get_memory_instance_with_DefaultConfig2 in tests",
            "the cluster is ProdClusterEastUS2Primary01Backup",
            "https://github.com/nornzach/norn-memory/blob/main/server/main.py",
            "My password is hunter2",
        ],
    )
    def test_ignores_ordinary_operational_text(self, text):
        assert self._find(text) == []


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@pytest.fixture
def scoped_client():
    """App client whose caller scope is whatever the test puts in holder["scope"]."""
    mock_memory = MagicMock()
    with patch("norn_m.Memory.from_config", return_value=mock_memory):
        import main

        main = importlib.reload(main)
    holder = {"scope": None}
    main.app.dependency_overrides[main.verify_auth] = lambda: None
    main.app.dependency_overrides[main.get_key_scope] = lambda: holder["scope"]
    with ExitStack() as stack:
        stack.enter_context(patch.object(main.webhooks, "emit_memory_results"))
        stack.enter_context(patch.object(main.webhooks, "emit"))
        categorize = stack.enter_context(patch.object(main.categorizer, "categorize_memories"))
        stack.enter_context(patch.object(main, "get_memory_instance", return_value=mock_memory))
        yield SimpleNamespace(
            client=TestClient(main.app), main=main, memory=mock_memory, holder=holder, categorize=categorize
        )
    main.app.dependency_overrides.clear()


ADD_BODY = {"messages": [{"role": "user", "content": "The VPN gateway is vpn.internal"}], "user_id": "phone"}


class TestAddMemoryScopes:
    def test_read_only_key_cannot_add(self, scoped_client):
        scoped_client.holder["scope"] = _scope(access="read")
        resp = scoped_client.client.post("/memories", json=ADD_BODY)
        assert resp.status_code == 403
        scoped_client.memory.add.assert_not_called()

    def test_key_cannot_write_into_another_namespace(self, scoped_client):
        scoped_client.holder["scope"] = _scope(user_ids=["phone"])
        resp = scoped_client.client.post("/memories", json={**ADD_BODY, "user_id": "laptop"})
        assert resp.status_code == 403
        scoped_client.memory.add.assert_not_called()

    def test_key_must_name_its_restricted_fields(self, scoped_client):
        scoped_client.holder["scope"] = _scope(user_ids=["phone"])
        body = {"messages": ADD_BODY["messages"], "agent_id": "claude"}
        assert scoped_client.client.post("/memories", json=body).status_code == 403

    def test_in_scope_add_goes_through(self, scoped_client):
        scoped_client.holder["scope"] = _scope(user_ids=["phone"])
        scoped_client.memory.add.return_value = {"results": []}
        resp = scoped_client.client.post("/memories", json=ADD_BODY)
        assert resp.status_code == 200
        assert scoped_client.memory.add.call_args.kwargs["user_id"] == "phone"

    def test_category_key_must_tag_with_its_categories_and_skip_inference(self, scoped_client):
        scoped_client.holder["scope"] = _scope(categories=["Ops"])
        scoped_client.memory.add.return_value = {"results": [{"id": M1, "memory": "x", "event": "ADD"}]}
        post = scoped_client.client.post

        assert post("/memories", json={**ADD_BODY, "infer": False}).status_code == 403
        assert (
            post("/memories", json={**ADD_BODY, "infer": False, "metadata": {"categories": ["Work"]}}).status_code
            == 403
        )
        assert post("/memories", json={**ADD_BODY, "metadata": {"categories": ["Ops"]}}).status_code == 403
        ok = post("/memories", json={**ADD_BODY, "infer": False, "metadata": {"categories": ["Ops"]}})

        assert ok.status_code == 200
        scoped_client.memory.add.assert_called_once()
        scoped_client.categorize.assert_not_called()


class TestReadScopes:
    def test_get_returns_404_for_a_memory_outside_the_scope(self, scoped_client):
        scoped_client.holder["scope"] = _scope(user_ids=["phone"])
        scoped_client.memory.get.return_value = _mem(M1, user_id="laptop")
        assert scoped_client.client.get(f"/memories/{M1}").status_code == 404
        assert scoped_client.client.get(f"/memories/{M1}/history").status_code == 404
        scoped_client.memory.history.assert_not_called()

    def test_get_returns_an_in_scope_memory(self, scoped_client):
        scoped_client.holder["scope"] = _scope(user_ids=["phone"])
        scoped_client.memory.get.return_value = _mem(M1, user_id="phone")
        resp = scoped_client.client.get(f"/memories/{M1}")
        assert resp.status_code == 200
        assert resp.json()["id"] == M1

    def test_list_defaults_to_the_keys_only_user_and_filters_results(self, scoped_client):
        scoped_client.holder["scope"] = _scope(user_ids=["phone"], agent_ids=["claude"])
        scoped_client.memory.get_all.return_value = {
            "results": [_mem("in", "phone", "claude"), _mem("out", "phone", "codex")]
        }

        resp = scoped_client.client.get("/memories")

        assert resp.status_code == 200
        assert [m["id"] for m in resp.json()["results"]] == ["in"]
        assert scoped_client.memory.get_all.call_args.kwargs["filters"] == {"user_id": "phone", "agent_id": "claude"}

    def test_list_rejects_another_namespace(self, scoped_client):
        scoped_client.holder["scope"] = _scope(user_ids=["phone"])
        assert scoped_client.client.get("/memories", params={"user_id": "laptop"}).status_code == 403

    def test_list_without_ids_scans_and_filters_for_multi_value_scopes(self, scoped_client):
        scoped_client.holder["scope"] = _scope(user_ids=["phone", "tablet"])
        rows = [_mem("a", "phone"), _mem("b", "laptop"), _mem("c", "tablet")]
        with patch.object(scoped_client.main, "list_memories", return_value=rows):
            resp = scoped_client.client.get("/memories")
        assert [m["id"] for m in resp.json()["results"]] == ["a", "c"]

    def test_search_fills_in_and_filters(self, scoped_client):
        scoped_client.holder["scope"] = _scope(user_ids=["phone"], categories=["Ops"])
        scoped_client.memory.search.return_value = {
            "results": [_mem("in", "phone", categories=["Ops"]), _mem("out", "phone", categories=["Travel"])]
        }

        resp = scoped_client.client.post("/search", json={"query": "vpn"})

        assert resp.status_code == 200
        assert [m["id"] for m in resp.json()["results"]] == ["in"]
        assert scoped_client.memory.search.call_args.kwargs["filters"] == {"user_id": "phone"}

    def test_search_rejects_another_namespace(self, scoped_client):
        scoped_client.holder["scope"] = _scope(user_ids=["phone"])
        resp = scoped_client.client.post("/search", json={"query": "vpn", "filters": {"user_id": "laptop"}})
        assert resp.status_code == 403
        scoped_client.memory.search.assert_not_called()

    def test_unscoped_callers_are_unchanged(self, scoped_client):
        scoped_client.memory.get.return_value = _mem(M1, user_id="laptop")
        scoped_client.memory.search.return_value = {"results": [_mem(M1, "laptop")]}
        assert scoped_client.client.get(f"/memories/{M1}").status_code == 200
        resp = scoped_client.client.post("/search", json={"query": "x", "filters": {"user_id": "laptop"}})
        assert len(resp.json()["results"]) == 1


class TestWriteScopes:
    def test_read_only_key_cannot_update_or_delete(self, scoped_client):
        scoped_client.holder["scope"] = _scope(access="read")
        scoped_client.memory.get.return_value = _mem(M1, user_id="phone")
        assert scoped_client.client.put(f"/memories/{M1}", json={"text": "x"}).status_code == 403
        assert scoped_client.client.delete(f"/memories/{M1}").status_code == 403
        scoped_client.memory.update.assert_not_called()
        scoped_client.memory.delete.assert_not_called()

    def test_cannot_update_or_delete_outside_the_scope(self, scoped_client):
        scoped_client.holder["scope"] = _scope(user_ids=["phone"])
        scoped_client.memory.get.return_value = _mem(M1, user_id="laptop")
        assert scoped_client.client.put(f"/memories/{M1}", json={"text": "x"}).status_code == 404
        assert scoped_client.client.delete(f"/memories/{M1}").status_code == 404
        scoped_client.memory.update.assert_not_called()
        scoped_client.memory.delete.assert_not_called()

    def test_category_key_keeps_its_categories_on_update(self, scoped_client):
        scoped_client.holder["scope"] = _scope(categories=["Ops"])
        scoped_client.memory.get.return_value = _mem(M1, categories=["Ops"])
        scoped_client.memory.update.return_value = {"message": "ok"}

        moved = scoped_client.client.put(f"/memories/{M1}", json={"metadata": {"categories": ["Travel"]}})
        edited = scoped_client.client.put(f"/memories/{M1}", json={"text": "new text"})

        assert moved.status_code == 403
        assert edited.status_code == 200
        scoped_client.categorize.assert_not_called()

    def test_admin_endpoints_refuse_scoped_keys(self, scoped_client):
        main = scoped_client.main
        request = MagicMock()
        request.state.key_scope = _scope(user_ids=["phone"])
        for dependency in (main.require_admin, main.verify_unscoped):
            with pytest.raises(HTTPException) as exc:
                asyncio.run(dependency(request, user=SimpleNamespace(role="admin")))
            assert exc.value.status_code == 403


class TestSecretGuardEndpoints:
    def test_add_with_a_key_in_the_text_is_rejected(self, scoped_client):
        body = {"messages": [{"role": "user", "content": f"Our key is {_openai_key()}"}], "user_id": "phone"}
        resp = scoped_client.client.post("/memories", json=body)
        assert resp.status_code == 400
        detail = resp.json()["detail"]
        assert "messages[0].content" in detail and "exact_set" in detail
        assert body["messages"][0]["content"].split()[-1] not in detail
        scoped_client.memory.add.assert_not_called()

    def test_add_with_a_secret_in_metadata_is_rejected(self, scoped_client):
        body = {**ADD_BODY, "metadata": {"note": "Authorization: Bearer " + secrets.token_hex(20)}}
        assert scoped_client.client.post("/memories", json=body).status_code == 400

    def test_update_with_a_secret_is_rejected(self, scoped_client):
        resp = scoped_client.client.put(f"/memories/{M1}", json={"text": "token " + _random_token()})
        assert resp.status_code == 400
        scoped_client.memory.update.assert_not_called()

    def test_vault_references_are_accepted(self, scoped_client):
        scoped_client.memory.add.return_value = {"results": []}
        body = {
            "messages": [{"role": "user", "content": "The OpenAI key for the agents is in 1Password: Infra/OpenAI"}],
            "user_id": "phone",
        }
        assert scoped_client.client.post("/memories", json=body).status_code == 200

    def test_admin_opt_out(self, scoped_client):
        scoped_client.memory.add.return_value = {"results": []}
        body = {"messages": [{"role": "user", "content": f"key {_openai_key()}"}], "user_id": "phone"}
        with patch.dict(os.environ, {"NORN_M_ALLOW_SECRETS": "true"}):
            assert scoped_client.client.post("/memories", json=body).status_code == 200


# ---------------------------------------------------------------------------
# Export and consolidation
# ---------------------------------------------------------------------------


@pytest.fixture
def router_client():
    with patch("norn_m.Memory.from_config", return_value=MagicMock()):
        import main

        main = importlib.reload(main)
    from routers import consolidation, export

    holder = {"scope": None}
    main.app.dependency_overrides[main.verify_auth] = lambda: None
    main.app.dependency_overrides[export.require_admin_or_scoped] = lambda: None
    main.app.dependency_overrides[main.get_key_scope] = lambda: holder["scope"]
    yield SimpleNamespace(client=TestClient(main.app), holder=holder, export=export, consolidation=consolidation)
    main.app.dependency_overrides.clear()


class TestExportScopes:
    ROWS = [
        {"id": "a", "memory": "x", "user_id": "phone", "categories": []},
        {"id": "b", "memory": "y", "user_id": "laptop", "categories": []},
    ]

    def test_export_only_contains_the_scope(self, router_client):
        router_client.holder["scope"] = _scope(user_ids=["phone"], access="read")
        with patch.object(router_client.export, "list_memories", return_value=self.ROWS):
            resp = router_client.client.get("/export")
        assert resp.status_code == 200
        assert [m["id"] for m in resp.json()["memories"]] == ["a"]

    def test_export_of_another_namespace_is_refused(self, router_client):
        router_client.holder["scope"] = _scope(user_ids=["phone"])
        assert router_client.client.get("/export", params={"user_id": "laptop"}).status_code == 403


class TestConsolidationScopes:
    def test_start_requires_write_and_a_pinned_scope(self, router_client):
        post = router_client.client.post
        router_client.holder["scope"] = _scope(access="read")
        assert post("/consolidation/runs", json={}).status_code == 403
        router_client.holder["scope"] = _scope(user_ids=["phone"])
        assert post("/consolidation/runs", json={}).status_code == 403
        assert post("/consolidation/runs", json={"user_id": "laptop"}).status_code == 403
        router_client.holder["scope"] = _scope(user_ids=["phone"], categories=["Ops"])
        assert post("/consolidation/runs", json={"user_id": "phone"}).status_code == 403

    def test_runs_outside_the_scope_are_hidden(self, router_client):
        visible = router_client.consolidation._visible
        scope = _scope(user_ids=["phone"])
        assert visible(SimpleNamespace(scope={"user_id": "phone"}), scope)
        assert not visible(SimpleNamespace(scope={"user_id": "laptop"}), scope)
        assert not visible(SimpleNamespace(scope={}), scope)
        assert visible(SimpleNamespace(scope={}), None)


# ---------------------------------------------------------------------------
# API key creation
# ---------------------------------------------------------------------------


class TestKeyScopesModel:
    def test_values_are_trimmed_and_deduped(self):
        from routers.api_keys import CreateKeyRequest

        body = CreateKeyRequest(label="phone", access="read", user_ids=[" phone ", "phone", ""], categories=["Ops"])
        assert body.user_ids == ["phone"]
        assert body.categories == ["Ops"]

    def test_unknown_access_is_rejected(self):
        from pydantic import ValidationError

        from routers.api_keys import CreateKeyRequest

        with pytest.raises(ValidationError):
            CreateKeyRequest(label="x", access="admin")
