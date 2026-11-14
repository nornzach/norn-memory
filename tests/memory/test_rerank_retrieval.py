"""Exercise real sync/async search with deterministic provider boundaries."""

import inspect
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from norn_m.memory.main import AsyncMemory, Memory


def row(key, score=0.8, **payload):
    return SimpleNamespace(id=key, score=score, payload={"data": key, "user_id": "alice", **payload})


@pytest.fixture(params=[Memory, AsyncMemory], ids=["sync", "async"])
def memory(request, monkeypatch):
    monkeypatch.setattr("norn_m.memory.main.lemmatize_for_bm25", lambda query: query)
    monkeypatch.setattr("norn_m.memory.main.extract_entities", lambda query: [])
    instance = request.param.__new__(request.param)
    instance.config = SimpleNamespace(reranker=SimpleNamespace(candidate_pool_size=6))
    instance.embedding_model = Mock()
    instance.embedding_model.embed.return_value = [1.0, 0.0]
    instance.vector_store = Mock()
    instance.vector_store.search.return_value = [row(str(i), 0.9 - i / 100) for i in range(6)]
    instance.vector_store.keyword_search.return_value = []
    instance.reranker = Mock()

    def rerank(query, documents, top_k):
        # Provider chooses the requested answer; search must actually supply it.
        ranked = sorted(documents, key=lambda item: item["id"] != "answer")
        return [{**item, "rerank_score": 0.9} for item in ranked[:top_k]]

    instance.reranker.rerank.side_effect = rerank
    return instance


async def search(memory, **kwargs):
    result = memory.search("query", filters={"user_id": "alice", "project": "atlas"}, **kwargs)
    return await result if inspect.isawaitable(result) else result


@pytest.mark.asyncio
async def test_answer_beyond_final_top_k_is_reranked(memory):
    memory.vector_store.search.return_value[4] = row("answer", 0.5)

    result = await search(memory, top_k=1, rerank=True)

    assert result["results"][0]["id"] == "answer"
    assert len(memory.reranker.rerank.call_args.args[1]) == 6
    assert len(result["results"]) == 1


@pytest.mark.asyncio
async def test_keyword_only_answer_enters_bounded_candidate_pool(memory):
    memory.vector_store.keyword_search.return_value = [row("answer", 0.1), row("0", 0.05)]

    result = await search(memory, top_k=1, rerank=True)

    assert result["results"][0]["id"] == "answer"
    documents = memory.reranker.rerank.call_args.args[1]
    assert len(documents) <= 6
    assert len({item["id"] for item in documents}) == len(documents)
    assert all(
        call.kwargs["filters"] == {"user_id": "alice", "project": "atlas"}
        for call in [memory.vector_store.search.call_args, memory.vector_store.keyword_search.call_args]
    )


@pytest.mark.asyncio
async def test_keyword_match_is_not_removed_by_semantic_threshold(memory):
    memory.vector_store.search.return_value = [row("answer", 0.01)]
    memory.vector_store.keyword_search.return_value = [row("answer", 0.1)]

    result = await search(memory, top_k=1, threshold=0.5, rerank=True)

    assert result["results"][0]["id"] == "answer"


@pytest.mark.asyncio
async def test_expired_keyword_answer_never_reaches_reranker(memory):
    memory.vector_store.keyword_search.return_value = [row("answer", 1.0, expiration_date="2000-01-01")]

    await search(memory, top_k=1, rerank=True)

    assert all(item["id"] != "answer" for item in memory.reranker.rerank.call_args.args[1])


@pytest.mark.asyncio
async def test_rerank_failure_returns_original_top_k_without_scores(memory):
    memory.reranker.rerank.side_effect = TimeoutError("provider timed out")

    result = await search(memory, top_k=2, rerank=True, explain=True)

    assert [item["id"] for item in result["results"]] == ["0", "1"]
    assert all("rerank_score" not in item for item in result["results"])
    assert result["rerank"]["status"] == "fallback"


@pytest.mark.asyncio
async def test_disabled_rerank_keeps_final_limit_and_does_not_call_provider(memory):
    result = await search(memory, top_k=1, rerank=False)

    assert [item["id"] for item in result["results"]] == ["0"]
    memory.reranker.rerank.assert_not_called()


@pytest.mark.asyncio
async def test_rerank_keeps_original_score_and_metadata(memory):
    memory.vector_store.search.return_value = [row("answer", 0.7, project="atlas", cwd="/repo")]
    before = deepcopy(memory.vector_store.search.return_value[0].payload)

    result = await search(memory, top_k=1, rerank=True)

    item = result["results"][0]
    assert item["score"] == pytest.approx(0.7)
    assert item["rerank_score"] == pytest.approx(0.9)
    assert item["metadata"]["project"] == "atlas"
    assert memory.vector_store.search.return_value[0].payload == before


@pytest.mark.asyncio
async def test_scope_filter_runs_before_pool_limit_and_provider(memory):
    memory.vector_store.search.return_value = [row("outside", 0.99), row("answer", 0.7)]
    memory.vector_store.keyword_search.return_value = [row("outside-keyword", 1.0)]
    result = await search(memory, top_k=1, rerank=True, _candidate_filter=lambda item: item["id"] == "answer")
    assert [item["id"] for item in memory.reranker.rerank.call_args.args[1]] == ["answer"]
    assert [item["id"] for item in result["results"]] == ["answer"]


@pytest.mark.asyncio
async def test_isolated_contexts_never_reach_reranker_from_either_source(memory):
    memory.vector_store.search.return_value = [
        row("debug-vector", 0.99, context="debug-secret"),
        row("answer", 0.7, context="chat"),
    ]
    memory.vector_store.keyword_search.return_value = [row("release-keyword", 1.0, context="release-secret")]

    result = await search(memory, top_k=2, rerank=True)

    assert [item["id"] for item in memory.reranker.rerank.call_args.args[1]] == ["answer"]
    assert [item["id"] for item in result["results"]] == ["answer"]


@pytest.mark.asyncio
async def test_rerank_failure_preserves_hierarchy_order_and_explanation(memory):
    memory.vector_store.search.return_value = [
        row("noise", 0.82, layer="L4", importance=2),
        row("core", 0.80, layer="L1", importance=9),
    ]
    baseline = await search(memory, top_k=2, rerank=False, explain=True)
    memory.reranker.rerank.side_effect = TimeoutError("provider timed out")

    result = await search(memory, top_k=2, rerank=True, explain=True)

    assert result["results"] == baseline["results"]
    assert result["results"][0]["id"] == "core"
    assert result["results"][0]["score_details"]["hierarchy_boost"] > 0
    assert result["rerank"]["status"] == "fallback"


@pytest.mark.asyncio
async def test_empty_candidates_skip_provider(memory):
    memory.vector_store.search.return_value = []
    result = await search(memory, rerank=True, explain=True)
    assert result["results"] == []
    assert result["rerank"]["status"] == "empty"
    memory.reranker.rerank.assert_not_called()


@pytest.mark.asyncio
async def test_successful_rejection_does_not_restore_unrelated_fallback(memory):
    memory.reranker.rerank.side_effect = lambda *args: []
    result = await search(memory, rerank=True, explain=True)
    assert result["results"] == []
    assert result["rerank"]["status"] == "applied"


@pytest.mark.asyncio
async def test_mutating_failed_provider_does_not_corrupt_fallback(memory):
    def fail(query, documents, top_k):
        documents[0]["memory"] = "corrupted"
        raise ValueError("bad response")

    memory.reranker.rerank.side_effect = fail
    result = await search(memory, top_k=1, rerank=True)
    assert result["results"][0]["memory"] == "0"


def test_close_releases_reranker_connections(memory):
    memory.close()
    memory.reranker.close.assert_called_once()
