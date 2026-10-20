"""Tests for the self-hosted server's categories, webhooks, analytics and export helpers.

The server modules import each other as top-level modules (``import webhooks``), so
``server/`` is put on ``sys.path`` here rather than importing them as ``server.*``.
"""

import csv
import hashlib
import hmac
import importlib
import io
import json
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
    "NORN_M_TELEMETRY": "false",
}


@pytest.fixture(scope="module", autouse=True)
def _server_env():
    with patch.dict(os.environ, TEST_ENV):
        yield


# ---------------------------------------------------------------------------
# Categorizer
# ---------------------------------------------------------------------------


class TestParseCategories:
    ALLOWED = ["Health", "Preferences", "Work", "Travel"]

    def _parse(self, response):
        import categorizer

        return categorizer.parse_categories(response, self.ALLOWED)

    def test_keeps_only_known_names_case_insensitively(self):
        assert self._parse('{"categories": ["health", "Cooking", "WORK"]}') == ["Health", "Work"]

    def test_extracts_json_from_surrounding_prose(self):
        reply = 'Sure! Here you go:\n```json\n{"categories": ["Travel"]}\n```'
        assert self._parse(reply) == ["Travel"]

    def test_accepts_a_bare_list_and_dedupes(self):
        assert self._parse('["Work", "work", "Health"]') == ["Work", "Health"]

    def test_caps_the_number_of_categories(self):
        assert self._parse('{"categories": ["Health", "Preferences", "Work", "Travel"]}') == [
            "Health",
            "Preferences",
            "Work",
        ]

    @pytest.mark.parametrize("reply", ["", "no json here", "{not valid json}", '{"categories": "Health"}', None])
    def test_unusable_replies_give_no_categories(self, reply):
        assert self._parse(reply) == []

    def test_reads_content_from_tool_style_dict_replies(self):
        assert self._parse({"content": '{"categories": ["Health"]}', "tool_calls": []}) == ["Health"]


class TestRewriteTagged:
    ROWS = [
        SimpleNamespace(id="only", payload={"categories": ["Travel"]}),
        SimpleNamespace(id="mixed", payload={"categories": ["Travel", "Work"]}),
        SimpleNamespace(id="other", payload={"categories": ["Work"]}),
    ]

    def _run(self, old_name, new_name):
        from routers import categories

        with patch.object(categories, "list_rows", return_value=self.ROWS):
            with patch.object(categories, "patch_payload") as patch_payload:
                categories._rewrite_tagged(old_name, new_name)
        return {c.args[0]: (c.args[1], c.kwargs.get("remove", ())) for c in patch_payload.call_args_list}

    def test_delete_returns_emptied_memories_to_untagged(self):
        calls = self._run("Travel", None)
        assert calls == {"only": ({}, ("categories",)), "mixed": ({"categories": ["Work"]}, ())}

    def test_rename_keeps_order_and_dedupes(self):
        calls = self._run("Travel", "Work")
        assert calls == {"only": ({"categories": ["Work"]}, ()), "mixed": ({"categories": ["Work"]}, ())}


# ---------------------------------------------------------------------------
# Webhooks
# ---------------------------------------------------------------------------


class TestBackfill:
    ROWS = [SimpleNamespace(id=f"m{i}", payload={"data": f"memory {i}", "categories": ["Work"]}) for i in range(5)] + [
        SimpleNamespace(id="new", payload={"data": "untagged"})
    ]

    def _queue(self, retag_all, limit):
        from fastapi import BackgroundTasks

        from routers import categories

        db = MagicMock()
        db.execute.return_value.first.return_value = ("some-category",)
        tasks = BackgroundTasks()
        with (
            patch.object(categories, "list_rows", return_value=self.ROWS),
            patch.object(categories, "BACKFILL_LIMIT", limit),
        ):
            result = categories.backfill_categories(tasks, retag_all=retag_all, _auth=None, db=db)
        categories._backfill_lock.release()
        return result, tasks.tasks[0].args[0] if tasks.tasks else []

    def test_untagged_only_by_default(self):
        result, items = self._queue(retag_all=False, limit=500)
        assert result.queued == 1 and items == [("new", "untagged")]

    def test_retag_all_is_not_capped(self):
        # A cap would redo the same first memories on every run and never reach the rest.
        result, items = self._queue(retag_all=True, limit=2)
        assert result.queued == 6 and [i for i, _ in items] == ["m0", "m1", "m2", "m3", "m4", "new"]


class TestWebhookSigning:
    def test_receiver_can_verify_signature(self):
        import webhooks

        secret = webhooks.generate_secret()
        body = webhooks.build_body("memory.created", {"id": "m1"})
        header = webhooks.sign(secret, body)

        # What a receiver would do with the documented scheme.
        expected = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        assert hmac.compare_digest(header, expected)

    def test_tampered_body_fails_verification(self):
        import webhooks

        secret = webhooks.generate_secret()
        header = webhooks.sign(secret, webhooks.build_body("memory.created", {"id": "m1"}))
        tampered = webhooks.build_body("memory.created", {"id": "m2"})
        assert not hmac.compare_digest(header, webhooks.sign(secret, tampered))

    def test_body_shape(self):
        import webhooks

        payload = json.loads(webhooks.build_body("memory.deleted", {"id": "m1"}))
        assert payload["event"] == "memory.deleted"
        assert payload["data"] == {"id": "m1"}
        assert "timestamp" in payload


def _fake_session(rows):
    session = MagicMock()
    session.__enter__.return_value = session
    session.execute.return_value.scalars.return_value.all.return_value = rows
    return session


class TestWebhookEmit:
    def test_only_subscribed_webhooks_receive_the_event(self):
        import webhooks

        rows = [
            SimpleNamespace(id="w1", url="http://a", secret="s1", events=["memory.created"]),
            SimpleNamespace(id="w2", url="http://b", secret="s2", events=["memory.deleted"]),
            SimpleNamespace(id="w3", url="http://c", secret="s3", events=["memory.created", "memory.updated"]),
        ]
        with patch.object(webhooks, "SessionLocal", return_value=_fake_session(rows)):
            with patch.object(webhooks._executor, "submit") as submit:
                webhooks.emit("memory.created", {"id": "m1"})

        targets = [call.args[2] for call in submit.call_args_list]
        assert targets == ["http://a", "http://c"]

    def test_emit_never_raises_when_the_database_is_down(self):
        import webhooks

        with patch.object(webhooks, "SessionLocal", side_effect=RuntimeError("db down")):
            webhooks.emit("memory.created", {"id": "m1"})

    def test_add_results_map_to_events(self):
        import webhooks

        results = [
            {"id": "a", "memory": "x", "event": "ADD"},
            {"id": "b", "memory": "y", "event": "UPDATE"},
            {"id": "c", "memory": "z", "event": "DELETE"},
            {"id": "d", "memory": "w", "event": "NONE"},
        ]
        with patch.object(webhooks, "emit") as emit:
            webhooks.emit_memory_results(results, {"user_id": "alice"})

        assert [(c.args[0], c.args[1]["id"], c.args[1]["user_id"]) for c in emit.call_args_list] == [
            ("memory.created", "a", "alice"),
            ("memory.updated", "b", "alice"),
            ("memory.deleted", "c", "alice"),
        ]


# ---------------------------------------------------------------------------
# Export and analytics helpers
# ---------------------------------------------------------------------------


class TestExport:
    MEMORIES = [
        {
            "id": "m1",
            "memory": 'Likes "green" tea, not coffee',
            "user_id": "alice",
            "agent_id": None,
            "run_id": None,
            "categories": ["Preferences", "Health"],
            "metadata": {"source": "chat"},
            "created_at": "2026-10-18T09:30:00+00:00",
            "updated_at": None,
        }
    ]

    def test_csv_round_trips(self):
        from routers.export import to_csv

        rows = list(csv.DictReader(io.StringIO(to_csv(self.MEMORIES))))
        assert len(rows) == 1
        assert rows[0]["memory"] == 'Likes "green" tea, not coffee'
        assert rows[0]["categories"] == "Preferences;Health"
        assert json.loads(rows[0]["metadata"]) == {"source": "chat"}

    def test_json_includes_filters_and_total(self):
        from routers.export import to_json

        payload = json.loads(to_json(self.MEMORIES, {"user_id": "alice"}))
        assert payload["total"] == 1
        assert payload["filters"] == {"user_id": "alice"}
        assert payload["memories"][0]["id"] == "m1"


class TestNormalizePath:
    @pytest.mark.parametrize(
        "path,expected",
        [
            ("/memories/0b6f1c1e-3f7a-4d1c-9a43-6a1f2b3c4d5e", "/memories/{id}"),
            ("/memories/0b6f1c1e-3f7a-4d1c-9a43-6a1f2b3c4d5e/history", "/memories/{id}/history"),
            ("/memories", "/memories"),
            ("/search", "/search"),
            ("/entities/user/alice", "/entities/user/alice"),
        ],
    )
    def test_collapses_id_segments(self, path, expected):
        from routers.analytics import normalize_path

        assert normalize_path(path) == expected


# ---------------------------------------------------------------------------
# POST /memories wiring
# ---------------------------------------------------------------------------


@pytest.fixture
def app_client():
    mock_memory = MagicMock()
    with patch("norn_m.Memory.from_config", return_value=mock_memory):
        import main

        main = importlib.reload(main)
    main.app.dependency_overrides[main.verify_auth] = lambda: None
    with ExitStack() as stack:
        emit_results = stack.enter_context(patch.object(main.webhooks, "emit_memory_results"))
        categorize = stack.enter_context(patch.object(main.categorizer, "categorize_memories"))
        stack.enter_context(patch.object(main, "get_memory_instance", return_value=mock_memory))
        yield TestClient(main.app), mock_memory, emit_results, categorize
    main.app.dependency_overrides.clear()


class TestAddMemoryHooks:
    BODY = {"messages": [{"role": "user", "content": "I like green tea"}], "user_id": "alice"}

    def test_emits_events_and_schedules_categorization(self, app_client):
        client, memory, emit_results, categorize = app_client
        memory.add.return_value = {
            "results": [
                {"id": "m1", "memory": "Likes green tea", "event": "ADD"},
                {"id": "m2", "memory": "Old fact", "event": "DELETE"},
            ]
        }

        resp = client.post("/memories", json=self.BODY)

        assert resp.status_code == 200
        emit_results.assert_called_once()
        assert emit_results.call_args.args[1] == {"user_id": "alice"}
        categorize.assert_called_once_with([("m1", "Likes green tea")])

    def test_caller_supplied_categories_skip_the_llm(self, app_client):
        client, memory, _, categorize = app_client
        memory.add.return_value = {"results": [{"id": "m1", "memory": "Likes green tea", "event": "ADD"}]}

        resp = client.post("/memories", json={**self.BODY, "metadata": {"categories": ["Preferences"]}})

        assert resp.status_code == 200
        categorize.assert_not_called()

    def test_failed_add_emits_nothing(self, app_client):
        client, memory, emit_results, categorize = app_client
        memory.add.side_effect = RuntimeError("vector store down")

        resp = client.post("/memories", json=self.BODY)

        assert resp.status_code >= 500
        emit_results.assert_not_called()
        categorize.assert_not_called()


# ---------------------------------------------------------------------------
# Provider configuration
# ---------------------------------------------------------------------------


class TestApplyConfigUpdates:
    BASE = {
        "llm": {"provider": "gemini", "config": {"model": "gemini-x", "api_key": "g-key", "temperature": 0.2}},
        "embedder": {"provider": "gemini", "config": {"model": "emb", "api_key": "g-key", "embedding_dims": 768}},
        "vector_store": {"provider": "pgvector", "config": {"embedding_model_dims": 768}},
    }

    def _apply(self, updates):
        from server_state import apply_config_updates

        return apply_config_updates(self.BASE, updates)

    def test_same_provider_keeps_unsent_keys(self):
        merged = self._apply({"llm": {"provider": "gemini", "config": {"model": "gemini-y"}}})

        assert merged["llm"]["config"] == {"model": "gemini-y", "api_key": "g-key", "temperature": 0.2}

    def test_provider_switch_drops_the_old_providers_keys(self):
        merged = self._apply(
            {"llm": {"provider": "openai", "config": {"model": "qwen", "openai_base_url": "http://llm:8000/v1"}}}
        )

        # The Gemini key must not be sent to the new endpoint; temperature is provider-neutral.
        assert merged["llm"] == {
            "provider": "openai",
            "config": {"model": "qwen", "openai_base_url": "http://llm:8000/v1", "temperature": 0.2},
        }

    def test_switching_back_does_not_leave_a_base_url_behind(self):
        compatible = self._apply(
            {"llm": {"provider": "openai", "config": {"model": "qwen", "openai_base_url": "http://llm:8000/v1"}}}
        )
        from server_state import apply_config_updates

        merged = apply_config_updates(compatible, {"llm": {"provider": "gemini", "config": {"model": "gemini-x"}}})

        assert "openai_base_url" not in merged["llm"]["config"]

    def test_new_base_url_on_the_same_provider_drops_the_saved_key(self):
        base = {"llm": {"provider": "openai", "config": {"model": "gpt", "api_key": "sk-openai"}}}
        from server_state import apply_config_updates

        merged = apply_config_updates(
            base, {"llm": {"provider": "openai", "config": {"model": "qwen", "openai_base_url": "http://x/v1"}}}
        )

        assert "api_key" not in merged["llm"]["config"]

    def test_clearing_an_unset_base_url_keeps_the_saved_key(self):
        base = {"llm": {"provider": "openai", "config": {"model": "gpt", "api_key": "sk-openai"}}}
        from server_state import apply_config_updates

        merged = apply_config_updates(
            base, {"llm": {"provider": "openai", "config": {"model": "gpt-5", "openai_base_url": None}}}
        )

        assert merged["llm"]["config"]["api_key"] == "sk-openai"

    def test_embedder_switch_keeps_embedding_dims_unless_overridden(self):
        kept = self._apply({"embedder": {"provider": "openai", "config": {"model": "bge"}}})
        cleared = self._apply({"embedder": {"provider": "openai", "config": {"model": "bge", "embedding_dims": None}}})

        assert kept["embedder"]["config"]["embedding_dims"] == 768
        assert cleared["embedder"]["config"]["embedding_dims"] is None


def _fake_embedder(dims):
    embedder = MagicMock()
    embedder.embed.return_value = [0.0] * dims
    return embedder


@pytest.fixture
def config_client():
    with patch("norn_m.Memory.from_config", return_value=MagicMock()):
        import main

        main = importlib.reload(main)
    main.app.dependency_overrides[main.require_admin] = lambda: None
    with ExitStack() as stack:
        update = stack.enter_context(patch.object(main, "update_config"))
        llm_factory = stack.enter_context(patch.object(main.config_check, "LlmFactory"))
        embedder_factory = stack.enter_context(patch.object(main.config_check, "EmbedderFactory"))
        yield TestClient(main.app), main, update, llm_factory, embedder_factory
    main.app.dependency_overrides.clear()


class TestConfigureEndpoints:
    COMPATIBLE_EMBEDDER = {
        "embedder": {
            "provider": "openai",
            "config": {"model": "bge-m3", "api_key": "k", "openai_base_url": "http://emb:8000/v1"},
        }
    }

    def test_save_rejects_an_embedder_whose_vectors_do_not_fit(self, config_client):
        client, main, update, _, embedder_factory = config_client
        expected = main.get_current_config()["vector_store"]["config"]["embedding_model_dims"]
        embedder_factory.create.return_value = _fake_embedder(expected + 1)

        resp = client.post("/configure", json=self.COMPATIBLE_EMBEDDER)

        assert resp.status_code == 400
        assert f"expects {expected}" in resp.json()["detail"]
        update.assert_not_called()

    def test_save_applies_an_embedder_with_the_right_size(self, config_client):
        client, main, update, _, embedder_factory = config_client
        expected = main.get_current_config()["vector_store"]["config"]["embedding_model_dims"]
        embedder_factory.create.return_value = _fake_embedder(expected)

        resp = client.post("/configure", json=self.COMPATIBLE_EMBEDDER)

        assert resp.status_code == 200
        update.assert_called_once_with(self.COMPATIBLE_EMBEDDER)
        provider, config, _ = embedder_factory.create.call_args.args
        assert provider == "openai"
        assert config["openai_base_url"] == "http://emb:8000/v1"

    def test_llm_only_change_does_not_probe_the_embedder(self, config_client):
        client, _, update, _, embedder_factory = config_client

        resp = client.post("/configure", json={"llm": {"provider": "openai", "config": {"model": "gpt-5-mini"}}})

        assert resp.status_code == 200
        embedder_factory.create.assert_not_called()
        update.assert_called_once()

    @pytest.mark.parametrize("url", ["file:///etc/passwd", "llm:8000", 42])
    def test_base_url_must_be_http(self, config_client, url):
        client, _, update, _, _ = config_client

        resp = client.post("/configure", json={"llm": {"provider": "openai", "config": {"openai_base_url": url}}})

        assert resp.status_code == 400
        update.assert_not_called()

    def test_test_endpoint_reports_both_checks_without_saving(self, config_client):
        client, main, update, llm_factory, embedder_factory = config_client
        expected = main.get_current_config()["vector_store"]["config"]["embedding_model_dims"]
        llm_factory.create.return_value.generate_response.side_effect = RuntimeError("401 invalid api key")
        embedder_factory.create.return_value = _fake_embedder(expected)

        resp = client.post("/configure/test", json=self.COMPATIBLE_EMBEDDER)

        assert resp.status_code == 200
        body = resp.json()
        assert body["llm"] == {"ok": False, "error": "401 invalid api key", "latency_ms": None}
        assert body["embedder"]["ok"] is True
        assert body["embedder"]["dims"] == expected
        update.assert_not_called()
