import json
from unittest.mock import Mock

import ingest
import knowledge
import pytest


def test_retry_keeps_report_even_without_knowledge(monkeypatch):
    stored = {}
    memory = Mock()
    memory.get.side_effect = stored.get
    messages = [{"role": "user", "content": "The counter stopped increasing after Tuesday."}]
    memory.llm.generate_response.return_value = json.dumps({"evidence": [{"message": 1, "quote": messages[0]["content"]}]})

    def create(text, embeddings, metadata, *, memory_id):
        stored[memory_id] = {"memory": text, "metadata": metadata}
        return memory_id

    memory._create_memory.side_effect = create
    monkeypatch.setattr(knowledge, "get_memory_instance", lambda: memory)
    curate = Mock(side_effect=[RuntimeError("offline"), []])
    monkeypatch.setattr(knowledge, "extract", curate)
    request = {"messages": messages, "params": {"user_id": "owner", "metadata": {"project": "demo"},
                                                "knowledge_policy": "curated"}, "job_id": "first",
               "observed_at": "2026-11-17T09:00:00+00:00"}
    with pytest.raises(RuntimeError, match="offline"):
        ingest.run_job(request)
    assert len(stored) == 1
    (event,) = ingest.run_job({**request, "job_id": "redelivered"})
    row = stored[event["id"]]
    assert event["event"] == "NONE" and row["memory"] == "user: " + messages[0]["content"]
    assert row["metadata"]["created_at"] == request["observed_at"] and row["metadata"]["project"] == "demo"
    memory._create_memory.assert_called_once()
    memory.llm.generate_response.assert_called_once()


@pytest.mark.parametrize("evidence", [[], [{"message": 1, "quote": "The database was broken."}]])
def test_no_chatter_or_fabricated_quote(monkeypatch, evidence):
    memory = Mock()
    memory.get.return_value = None
    memory.llm.generate_response.return_value = json.dumps({"evidence": evidence})
    monkeypatch.setattr(knowledge, "get_memory_instance", lambda: memory)
    monkeypatch.setattr(knowledge, "extract", lambda *args: [])
    request = {"messages": [{"role": "user", "content": "Hello"}],
               "params": {"user_id": "owner", "knowledge_policy": "curated"}}
    if evidence:
        with pytest.raises(RuntimeError):
            ingest.run_job(request)
    else:
        assert ingest.run_job(request) == []
    memory._create_memory.assert_not_called()
