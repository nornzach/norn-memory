import json
from datetime import timedelta
from unittest.mock import Mock
from uuid import UUID

import auth
import knowledge
import pytest
from db import Base
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from models import KnowledgeItem, KnowledgeProposal, KnowledgeRevision, User
from routers.knowledge import router
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool


@pytest.fixture
def db(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(
        engine,
        tables=[
            User.__table__,
            KnowledgeItem.__table__,
            KnowledgeProposal.__table__,
            KnowledgeRevision.__table__,
        ],
    )
    monkeypatch.setattr(knowledge, "SessionLocal", sessionmaker(engine, expire_on_commit=False))
    yield
    engine.dispose()


def candidate(**changes):
    data = {
        "action": "create",
        "type": "procedure",
        "key": "gui/release",
        "title": "OMP GUI release",
        "trigger": "When publishing a new GUI tag",
        "summary": "Verify the full sidecar pin from the tag.",
        "procedure": {
            "prerequisites": ["Check both remote repositories."],
            "steps": [{"id": "pin", "text": "Compare the complete SHA."}],
            "success_criteria": ["Compare updater files to the uploaded assets."],
            "failure_branches": [{"id": "recover", "text": "Diagnose the tagged pin before dispatch."}],
        },
        "reuse": 2,
        "impact": 2,
        "actionability": 2,
        "evidence_refs": [1],
        "aliases": ["发版", "发布"],
    }
    return knowledge.Candidate.model_validate({**data, **changes})


def scope(**changes):
    return {"user_id": "zach", "project": "oh-my-pi", "agent_id": "", "run_id": "", **changes}


def stage(proposal, *, fingerprint="a", task_id=None, **scope_changes):
    return knowledge.stage(proposal, scope(**scope_changes), [{"fingerprint": fingerprint}], task_id)


def publish(proposal, decision="publish"):
    return knowledge.review(
        UUID(proposal["id"]),
        knowledge.Review(
            decision=decision,
            reason="Reviewed against the source.",
            evidence_status="verified",
            evidence=[
                knowledge.Evidence(source="CI check", observed_at=knowledge.now(), observation="Full SHA resolved.")
            ],
        ),
    )


def search(purpose="action", task_id=None, user_id="zach", project="oh-my-pi", **ids):
    return knowledge.search("OMP GUI 发版", {"user_id": user_id, **ids}, project, purpose, task_id, 10)


def test_admin_can_browse_knowledge_without_a_memory_user_id(db, monkeypatch):
    monkeypatch.setattr(auth, "AUTH_DISABLED", False)
    monkeypatch.setattr(auth, "ADMIN_API_KEY", "test-key")
    monkeypatch.setattr(auth, "SessionLocal", knowledge.SessionLocal)
    pending = stage(candidate(key="pending"), user_id="other")
    rule = publish(stage(candidate()))
    case = publish(stage(candidate(action="evidence", type="case", key="release-case", procedure=None)))
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)

    for path in ("/knowledge/items", "/knowledge/proposals"):
        assert client.get(path).status_code == 401
    client.headers["X-API-Key"] = "test-key"
    assert [row["id"] for row in client.get("/knowledge/proposals").json()] == [pending["id"]]
    assert client.get("/knowledge/proposals", params={"user_id": "zach"}).json() == []
    assert [row["id"] for row in client.get("/knowledge/items").json()] == [case["id"], rule["id"]]
    assert client.get("/knowledge/items", params={"limit": 1, "offset": 1}).json()[0]["id"] == rule["id"]


def test_unreviewed_never_recalled_and_same_observation_is_idempotent(db):
    initial = stage(candidate())
    assert search() == []
    assert stage(candidate())["id"] == initial["id"]
    item = publish(initial)
    assert search() == [item]
    assert item["layer"] == "L1" and item["importance"] == 6
    assert search(user_id="someone-else") == []
    assert search(project="other") == []
    assert search("history") == []


def test_ingest_publishes_once_without_a_reviewer(db, monkeypatch):
    memory = Mock()
    memory.get.return_value = None
    quote = "For OMP GUI releases verify the full sidecar pin from the tag."
    memory.llm.generate_response.return_value = json.dumps({"evidence": [{"message": 1, "quote": quote}]})
    monkeypatch.setattr(knowledge, "get_memory_instance", lambda: memory)
    monkeypatch.setattr(knowledge, "extract", lambda *args: [candidate()])
    indexed = Mock()
    monkeypatch.setattr(knowledge, "index_revision", indexed)
    messages = [{"role": "user", "content": "For OMP GUI releases verify the full sidecar pin from the tag."}]
    params = {"user_id": "zach", "metadata": {"project": "oh-my-pi"}}
    episode, result = knowledge.ingest(messages, params)
    assert result["status"] == "applied"
    (item,) = search()
    assert item["evidence_status"] == "reported" and not item["verified_at"]
    assert item["revision"] == 1 and item["evidence"]
    assert item["evidence"][0]["memory_id"] == episode["id"]
    assert knowledge.ingest(messages, params)[1]["event"] == "NONE"
    indexed.assert_called_once_with(item)


def test_worker_resolves_old_exchanges_but_not_admin_drafts(db, monkeypatch):
    monkeypatch.setattr(knowledge, "index_revision", lambda item: True)
    manual = stage(candidate(key="manual"))
    source = {"job_id": None, "message": 1, "role": "assistant", "observed_at": knowledge.now().isoformat()}
    for proposal in (
        candidate(),
        candidate(action="draft", procedure=None, key="unfinished"),
        candidate(type="constraint", procedure=None, key="unconfirmed"),
        candidate(action="patch", base_revision=19, procedure=None, step_updates=[{"id": "pin", "text": "stale"}]),
    ):
        knowledge.stage(proposal, scope(), [{**source, "fingerprint": knowledge._digest(proposal.model_dump())}])
    assert knowledge.resolve_backlog(limit=10) == 4
    assert knowledge.resolve_backlog(limit=10) == 0
    assert [row["id"] for row in knowledge.list_proposals("zach", None, "proposed", 10)] == [manual["id"]]
    assert len(knowledge.list_proposals("zach", None, "dismissed", 10)) == 3
    assert [item["key"] for item in search()] == ["gui/release"]


@pytest.mark.parametrize(("role", "verbatim", "published"), [("user", True, True), ("user", False, False),
                                                               ("assistant", True, False)])
def test_automatic_constraint_requires_the_cited_user_statement(db, monkeypatch, role, verbatim, published):
    memory = Mock()
    memory.get.return_value = None
    memory.llm.generate_response.return_value = '{"evidence":[]}'
    monkeypatch.setattr(knowledge, "get_memory_instance", lambda: memory)
    summary = "Always verify the OMP GUI tag."
    rule = candidate(type="constraint", procedure=None, summary=summary)
    monkeypatch.setattr(knowledge, "extract", lambda *args: [rule])
    monkeypatch.setattr(knowledge, "index_revision", lambda item: True)
    messages = [{"role": role, "content": summary if verbatim else "Check the tag for this release only."}]
    (event,) = knowledge.ingest(messages, {"user_id": "zach", "metadata": {"project": "oh-my-pi"}})
    assert event["status"] == ("applied" if published else "dismissed")
    assert [item["evidence_status"] for item in search()] == (["user_confirmed"] if published else [])


def test_patch_edits_only_named_steps_and_restoration_is_versioned(db):
    original = publish(stage(candidate()))
    patch = candidate(
        action="patch",
        procedure=None,
        base_revision=1,
        step_updates=[{"id": "pin", "text": "Resolve the full SHA on the remote fork."}],
    )
    first = stage(patch, fingerprint="b")
    stale = stage(patch, fingerprint="c")
    updated = publish(first)
    assert updated["id"] == original["id"] and updated["revision"] == 2
    assert updated["procedure"]["steps"][0]["text"] == "Resolve the full SHA on the remote fork."
    assert updated["procedure"]["success_criteria"] == original["procedure"]["success_criteria"]
    with pytest.raises(HTTPException, match="Current revision changed"):
        publish(stale)
    restored = knowledge.restore(
        UUID(original["id"]),
        "zach",
        knowledge.Restore(
            revision=1,
            base_revision=2,
            reason="Review the earlier recovery steps.",
        ),
    )
    assert restored["procedure"] == original["procedure"] and restored["needs_recheck"]
    assert [entry["revision"] for entry in knowledge.revisions(UUID(original["id"]), {"user_id": "zach"})] == [3, 2, 1]


def test_cases_and_handoffs_are_not_injected_as_current_instructions(db, monkeypatch):
    event = candidate(action="evidence", type="case", key="gui/release-v1", procedure=None)
    work = candidate(action="handoff", type="handoff", key="current-check", procedure=None)
    publish(stage(event))
    publish(stage(work, task_id="release-a"))
    assert search() == []
    assert [item["layer"] for item in search("history")] == ["L2"]
    assert search("resume", "release-b") == []
    assert [item["layer"] for item in search("resume", "release-a")] == ["L3"]
    later = knowledge.now() + timedelta(days=8)
    monkeypatch.setattr(knowledge, "now", lambda: later)
    assert search("resume", "release-a") == []


def test_extraction_can_discard_instead_of_writing_and_rejects_invented_evidence(db):
    llm = Mock()
    messages = [{"role": "user", "content": "Still building the third artifact"}]
    llm.generate_response.return_value = '{"proposals": []}'
    assert knowledge.extract(messages, scope(), None, llm=llm) == []
    candidate_json = candidate(evidence_refs=[2]).model_dump()
    llm.generate_response.return_value = json.dumps({"proposals": [candidate_json]})
    with pytest.raises(RuntimeError, match="invalid proposal"):
        knowledge.extract(messages, scope(), None, llm=llm)
    assert knowledge.list_proposals("zach", None, "proposed", 10) == []


def test_project_alias_matches_a_specific_folder_not_every_gui(monkeypatch):
    monkeypatch.setenv("NORN_M_KNOWLEDGE_PROJECT_ALIASES", '{"/workspace/oh-my-pi/packages/gui":"oh-my-pi"}')
    assert knowledge.canonical_project("gui", "/workspace/oh-my-pi/packages/gui/src") == "oh-my-pi"
    assert knowledge.canonical_project("gui", "/workspace/other/packages/gui") == "gui"


def test_provider_only_receives_scoped_published_candidates_and_falls_back(db, monkeypatch):
    for index in range(4):
        publish(stage(candidate(key=f"gui/release-{index}")))
    publish(stage(candidate(key="gui/private"), user_id="other"))
    publish(stage(candidate(key="gui/other-project"), project="another-project"))
    stage(candidate(key="gui/pending"))
    memory = Mock()
    memory.reranker.rerank.side_effect = TimeoutError
    monkeypatch.setattr(knowledge, "get_memory_instance", lambda: memory)
    details = {}
    baseline = search()
    result = knowledge.search(
        "OMP GUI release", {"user_id": "zach"}, "oh-my-pi", "action", None, 10, rerank=True, details=details
    )
    assert {row["key"] for row in result} == {row["key"] for row in baseline}
    assert details == {"status": "fallback", "candidate_count": 4}
    assert {row["id"] for row in memory.reranker.rerank.call_args.args[1]} == {row["id"] for row in baseline}


def test_semantic_recall_only_uses_current_compatible_vector(db, monkeypatch):
    item = publish(stage(candidate()))
    memory = Mock()
    memory.embedding_model.embed.return_value = [0.8, 0.6]
    monkeypatch.setattr(knowledge, "get_memory_instance", lambda: memory)
    monkeypatch.setattr(knowledge, "_embedder_identity", lambda: "first")
    assert knowledge.index_revision(item)
    args = ("ship packaging", {"user_id": "zach"}, "oh-my-pi", "action", None, 10)
    assert knowledge.search(*args, semantic=True)[0]["id"] == item["id"]
    monkeypatch.setattr(knowledge, "_embedder_identity", lambda: "second")
    assert knowledge.search(*args, semantic=True) == []


def test_incomplete_method_is_pending_until_completed_by_reviewer(db):
    draft = stage(candidate(action="draft", procedure=None))
    with pytest.raises(HTTPException, match="Complete the draft"):
        publish(draft)
    assert search() == []
    included = knowledge.review(
        UUID(draft["id"]),
        knowledge.Review(
            decision="publish",
            reason="Checked the workflow source and confirmed the steps.",
            evidence_status="verified",
            evidence=[
                knowledge.Evidence(source="CI check", observed_at=knowledge.now(), observation="Full SHA resolved.")
            ],
            revised_candidate=candidate(),
        ),
    )
    assert search() == [included]
