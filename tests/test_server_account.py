"""Tests for the self-hosted server's import endpoint, sign-in sessions, API keys and request logs.

The server modules import each other as top-level modules (``import webhooks``), so
``server/`` is put on ``sys.path`` here rather than importing them as ``server.*``.
"""

import importlib
import os
import sys
import time
import uuid
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

pytest.importorskip("fastapi", reason="fastapi not installed")
pytest.importorskip("httpx", reason="httpx not installed")

from fastapi import HTTPException  # noqa: E402
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


# ---------------------------------------------------------------------------
# Request log: which API key made the call
# ---------------------------------------------------------------------------


def _logged_call(main, headers):
    """Make one logged request and return the arguments the request log was written with."""
    persist = MagicMock()
    with patch.object(main, "_persist_request_log", persist):
        TestClient(main.app).post("/import", json={}, headers=headers)
        deadline = time.monotonic() + 2
        while not persist.called and time.monotonic() < deadline:
            time.sleep(0.01)
    assert persist.called
    return persist.call_args.args


class TestRequestLogKey:
    @pytest.fixture
    def main(self):
        with patch("norn_m.Memory.from_config", return_value=MagicMock()):
            import main

            return importlib.reload(main)

    def test_records_the_label_of_the_key_that_called(self, main):
        import auth

        owner = SimpleNamespace(id=uuid.uuid4(), role="admin")
        with patch.object(auth, "_resolve_user_from_api_key", return_value=(owner, None, "Laptop")):
            args = _logged_call(main, {"X-API-Key": "m0-test-key-not-real"})

        assert args[0:2] == ("POST", "/import")
        assert args[4:] == ("api_key", "Laptop")

    def test_admin_key_is_recorded_as_admin(self, main):
        import auth

        admin = SimpleNamespace(id=uuid.uuid4(), role="admin")
        with (
            patch.object(auth, "ADMIN_API_KEY", "admin-test-key-not-real"),
            patch.object(auth, "_get_default_user", return_value=admin),
        ):
            args = _logged_call(main, {"X-API-Key": "admin-test-key-not-real"})

        assert args[4:] == ("admin_api_key", "admin")

    def test_unauthenticated_calls_have_no_label(self, main):
        args = _logged_call(main, {})

        assert args[5] is None


# ---------------------------------------------------------------------------
# Postgres-backed: sessions, API keys and request logs
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def pg_engine():
    url = os.environ.get("NORN_M_TEST_POSTGRES_URL")
    if not url:
        pytest.skip("NORN_M_TEST_POSTGRES_URL is not set")
    from sqlalchemy import create_engine
    from sqlalchemy.exc import OperationalError

    from db import Base
    from models import APIKey, RefreshTokenJti, RequestLog, User

    engine = create_engine(url)
    tables = [User.__table__, APIKey.__table__, RefreshTokenJti.__table__, RequestLog.__table__]
    try:
        Base.metadata.drop_all(engine, tables=tables)
    except OperationalError as exc:
        pytest.skip(f"Test database unreachable: {exc.__class__.__name__}")
    Base.metadata.create_all(engine, tables=tables)
    yield engine
    Base.metadata.drop_all(engine, tables=tables)
    engine.dispose()


@pytest.fixture
def db(pg_engine):
    from sqlalchemy import text
    from sqlalchemy.orm import sessionmaker

    with pg_engine.begin() as conn:
        conn.execute(text("TRUNCATE users, api_keys, refresh_token_jtis, request_logs CASCADE"))
    session = sessionmaker(bind=pg_engine, autoflush=False, expire_on_commit=False)()
    yield session
    session.close()


def _user(db, email="me@example.com"):
    from auth import hash_password
    from models import User

    user = User(name="Me", email=email, password_hash=hash_password("password123"), role="admin")
    db.add(user)
    db.commit()
    return user


class TestSessions:
    def test_counts_only_live_refresh_tokens(self, db):
        from auth import consume_refresh_jti, create_refresh_token, decode_token
        from routers import auth as auth_router

        user = _user(db)
        create_refresh_token(str(user.id), db)
        used = create_refresh_token(str(user.id), db)
        consume_refresh_jti(decode_token(used)["jti"], db)

        assert auth_router.sessions(user=user, db=db).active == 1

    def test_sign_out_others_keeps_the_callers_token(self, db):
        from auth import consume_refresh_jti, create_refresh_token, decode_token
        from routers import auth as auth_router

        user = _user(db)
        mine = create_refresh_token(str(user.id), db)
        other = create_refresh_token(str(user.id), db)
        create_refresh_token(str(user.id), db)

        result = auth_router.sign_out_others(SimpleNamespace(refresh_token=mine), user=user, db=db)

        assert result.signed_out == 2
        consume_refresh_jti(decode_token(mine)["jti"], db)
        with pytest.raises(HTTPException):
            consume_refresh_jti(decode_token(other)["jti"], db)

    def test_sign_out_others_rejects_someone_elses_token(self, db):
        from auth import create_refresh_token
        from routers import auth as auth_router

        me, them = _user(db), _user(db, "them@example.com")
        theirs = create_refresh_token(str(them.id), db)

        with pytest.raises(HTTPException) as exc:
            auth_router.sign_out_others(SimpleNamespace(refresh_token=theirs), user=me, db=db)
        assert exc.value.status_code == 400
        assert auth_router.sessions(user=them, db=db).active == 1

    def test_logout_revokes_the_token(self, db):
        from auth import consume_refresh_jti, create_refresh_token, decode_token
        from routers import auth as auth_router

        user = _user(db)
        token = create_refresh_token(str(user.id), db)

        auth_router.logout(SimpleNamespace(refresh_token=token), db=db)

        with pytest.raises(HTTPException):
            consume_refresh_jti(decode_token(token)["jti"], db)

    def test_logout_ignores_garbage(self, db):
        from routers import auth as auth_router

        assert auth_router.logout(SimpleNamespace(refresh_token="not-a-jwt"), db=db).message == "Signed out."


class TestUpdateKey:
    def _key(self, db, user):
        from routers import api_keys

        body = api_keys.CreateKeyRequest(label="Laptop", user_ids=["alice"])
        return api_keys.create_key(body, user=user, db=db)

    def test_renames_and_rescopes_without_changing_the_secret(self, db):
        from models import APIKey
        from routers import api_keys

        user = _user(db)
        created = self._key(db, user)
        before = db.get(APIKey, uuid.UUID(created.id)).key_hash

        body = api_keys.UpdateKeyRequest(label=" MacBook ", access="read", agent_ids=["bot"])
        updated = api_keys.update_key(created.id, body, user=user, db=db)

        assert (updated.label, updated.access) == ("MacBook", "read")
        assert updated.user_ids == [] and updated.agent_ids == ["bot"]
        db.expire_all()
        assert db.get(APIKey, uuid.UUID(created.id)).key_hash == before

    def test_cannot_edit_another_users_key(self, db):
        from routers import api_keys

        owner, other = _user(db), _user(db, "other@example.com")
        created = self._key(db, owner)

        with pytest.raises(HTTPException) as exc:
            api_keys.update_key(created.id, api_keys.UpdateKeyRequest(label="Mine now"), user=other, db=db)
        assert exc.value.status_code == 404

    def test_cannot_edit_a_revoked_key(self, db):
        from routers import api_keys

        user = _user(db)
        created = self._key(db, user)
        api_keys.revoke_key(created.id, user=user, db=db)

        with pytest.raises(HTTPException) as exc:
            api_keys.update_key(created.id, api_keys.UpdateKeyRequest(label="Back"), user=user, db=db)
        assert exc.value.status_code == 400


class TestListRequests:
    def _log(self, db, auth_type, key_label):
        from models import RequestLog

        db.add(
            RequestLog(
                method="GET",
                path="/memories",
                status_code=200,
                latency_ms=3.0,
                auth_type=auth_type,
                key_label=key_label,
            )
        )
        db.commit()

    def test_returns_the_key_label_and_filters_by_it(self, db):
        from routers import requests

        self._log(db, "api_key", "Laptop")
        self._log(db, "api_key", "Phone")
        self._log(db, "admin_api_key", "admin")
        self._log(db, "bearer", None)

        everything = requests.list_requests(_auth=None, db=db, limit=50, key=None)
        laptop = requests.list_requests(_auth=None, db=db, limit=50, key="Laptop")

        assert sorted(log.key_label for log in everything) == ["Laptop", "Phone", "admin"]
        assert [log.key_label for log in laptop] == ["Laptop"]


class TestShowKey:
    def _create(self, db, user, label="Laptop"):
        from routers import api_keys

        return api_keys.create_key(api_keys.CreateKeyRequest(label=label), user=user, db=db)

    def test_owner_can_show_a_new_key_again(self, db):
        from models import APIKey
        from routers import api_keys

        user = _user(db)
        created = self._create(db, user)

        shown = api_keys.get_key(created.id, user=user, db=db)

        assert shown.key == created.key
        assert [k.retrievable for k in api_keys.list_keys(user=user, db=db)] == [True]
        stored = db.get(APIKey, uuid.UUID(created.id)).key_ciphertext
        assert stored and created.key not in stored

    def test_keys_from_before_copies_were_kept_cannot_be_shown(self, db):
        from models import APIKey
        from routers import api_keys

        user = _user(db)
        created = self._create(db, user)
        db.get(APIKey, uuid.UUID(created.id)).key_ciphertext = None
        db.commit()

        with pytest.raises(HTTPException) as exc:
            api_keys.get_key(created.id, user=user, db=db)
        assert exc.value.status_code == 409
        assert [k.retrievable for k in api_keys.list_keys(user=user, db=db)] == [False]

    def test_a_changed_jwt_secret_makes_copies_unreadable(self, db):
        from routers import api_keys

        user = _user(db)
        created = self._create(db, user)

        with patch.dict(os.environ, {"JWT_SECRET": "a-different-secret-for-pytest-0123456789"}):
            with pytest.raises(HTTPException) as exc:
                api_keys.get_key(created.id, user=user, db=db)
        assert exc.value.status_code == 409

    def test_cannot_show_another_users_or_a_revoked_key(self, db):
        from routers import api_keys

        owner, other = _user(db), _user(db, "other@example.com")
        created = self._create(db, owner)

        with pytest.raises(HTTPException) as exc:
            api_keys.get_key(created.id, user=other, db=db)
        assert exc.value.status_code == 404
        api_keys.revoke_key(created.id, user=owner, db=db)
        with pytest.raises(HTTPException) as exc:
            api_keys.get_key(created.id, user=owner, db=db)
        assert exc.value.status_code == 400
