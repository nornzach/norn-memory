import json

import httpx
import pytest

from norn_m.memory.main import _finish_search
from norn_m.utils.factory import RerankerFactory

MEMORIES = [
    {"id": "a", "memory": "Uses coffee filters", "score": 0.8, "_recall_rank": 0.01},
    {"id": "b", "memory": "Prefers green tea", "score": 0.4, "_recall_rank": 0.008},
]


@pytest.fixture
def make_reranker(monkeypatch):
    monkeypatch.setenv("JINA_API_KEY", "test-key")
    client_class = httpx.Client

    def make(handler, **config):
        monkeypatch.setattr(httpx, "Client", lambda **kw: client_class(transport=httpx.MockTransport(handler), **kw))
        return RerankerFactory.create("jina", config)

    return make


def test_jina_ranks_negative_scores_and_keeps_memory_identity(make_reranker):
    def handler(request):
        assert str(request.url) == "https://api.jina.ai/v1/rerank"
        assert request.headers["authorization"] == "Bearer test-key"
        assert json.loads(request.content) == {
            "model": "jina-reranker-v3",
            "query": "tea",
            "documents": ["Uses coffee filters", "Prefers green tea"],
            "top_n": 2,
            "return_documents": False,
        }
        return httpx.Response(
            200, json={"results": [{"index": 0, "relevance_score": -0.8}, {"index": 1, "relevance_score": -0.1}]}
        )

    reranker = make_reranker(handler)
    try:
        result = _finish_search("tea", MEMORIES, reranker, 1, 2, True)
    finally:
        reranker.close()
    assert result["rerank"]["status"] == "applied"
    assert result["results"] == [{"id": "b", "memory": "Prefers green tea", "score": 0.4, "rerank_score": -0.1}]


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(429, text="test-key"),
        httpx.Response(503),
        httpx.Response(200, json={"results": [{"index": 0, "relevance_score": 0.9}]}),
        httpx.Response(200, json={"results": [{"index": 0, "relevance_score": 0.9}] * 2}),
        None,
    ],
)
def test_jina_failure_returns_baseline_without_fabricated_scores(make_reranker, response):
    def handler(request):
        if response is None:
            raise httpx.ReadTimeout("temporary timeout", request=request)
        return response

    reranker = make_reranker(handler, min_score=0.8)
    try:
        result = _finish_search("tea", MEMORIES, reranker, 1, 2, True)
    finally:
        reranker.close()
    assert result["rerank"]["status"] == "fallback"
    assert result["results"] == [{"id": "a", "memory": "Uses coffee filters", "score": 0.8}]
