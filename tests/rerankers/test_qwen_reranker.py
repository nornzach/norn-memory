import json
from copy import deepcopy
from unittest.mock import patch

import httpx
import pytest

from norn_m.utils.factory import RerankerFactory


def make_reranker(handler, **config):
    client_type = httpx.Client

    def make_client(**kwargs):
        return client_type(transport=httpx.MockTransport(handler), **kwargs)

    with patch("norn_m.reranker.qwen_reranker.httpx.Client", side_effect=make_client):
        reranker = RerankerFactory.create("qwen", {"api_key": "test-key", **config})
        return reranker, reranker.client


def test_compatible_request_and_scores_preserve_memory_identity():
    documents = [{"id": "a", "memory": "coffee", "score": 0.8}, {"id": "b", "memory": "tea", "score": 0.4}]
    before = deepcopy(documents)

    def handler(request):
        assert str(request.url) == "https://maas.qianwenaiapi.com/compatible-api/v1/reranks"
        assert request.headers["authorization"] == "Bearer test-key"
        body = json.loads(request.content)
        assert body == {
            "model": "qwen3.7-text-rerank",
            "query": "drink",
            "documents": ["coffee", "tea"],
            "top_n": 2,
            "return_documents": False,
        }
        return httpx.Response(
            200, json={"results": [{"index": 1, "relevance_score": 0.95}, {"index": 0, "relevance_score": 0.2}]}
        )

    reranker, _ = make_reranker(handler)
    result = reranker.rerank("drink", documents, top_k=1)

    assert result == [{**documents[1], "rerank_score": 0.95}]
    assert documents == before


@pytest.mark.parametrize(
    "rows",
    [
        [{"index": 3, "relevance_score": 0.9}, {"index": 1, "relevance_score": 0.8}],
        [{"index": 0, "relevance_score": 0.9}, {"index": 0, "relevance_score": 0.8}],
        [{"index": True, "relevance_score": 0.9}, {"index": 0, "relevance_score": 0.8}],
        [{"index": 0, "relevance_score": "0.9"}, {"index": 1, "relevance_score": 0.8}],
        [{"index": 0, "relevance_score": float("nan")}, {"index": 1, "relevance_score": 0.8}],
        [{"index": 0, "relevance_score": 0.9}],
        [],
    ],
)
def test_invalid_or_incomplete_response_is_an_error(rows):
    reranker, _ = make_reranker(lambda request: httpx.Response(200, content=json.dumps({"results": rows})))

    with pytest.raises(ValueError, match="response"):
        reranker.rerank("query", [{"memory": "a"}, {"memory": "b"}])


def test_score_threshold_can_return_no_results_after_success():
    reranker, _ = make_reranker(
        lambda request: httpx.Response(200, json={"results": [{"index": 0, "relevance_score": 0.23}]}),
        min_score=0.5,
    )

    assert reranker.rerank("cat's name", [{"memory": "uses Python"}]) == []


def test_timeout_is_an_error_not_a_fabricated_zero_score():
    def handler(request):
        raise httpx.ReadTimeout("timeout", request=request)

    reranker, _ = make_reranker(handler, min_score=0.5)

    with pytest.raises(RuntimeError, match="timed out"):
        reranker.rerank("query", [{"memory": "a"}])


def test_http_error_never_includes_secret_response_body():
    reranker, _ = make_reranker(lambda request: httpx.Response(401, text="test-key must not appear"))

    with pytest.raises(RuntimeError, match="HTTP 401") as exc:
        reranker.rerank("query", [{"memory": "a"}])
    assert "test-key" not in str(exc.value)


def test_empty_input_makes_no_http_request():
    calls = []
    reranker, _ = make_reranker(lambda request: calls.append(request))

    assert reranker.rerank("query", []) == []
    assert calls == []


@pytest.mark.parametrize("config", [{"timeout": 0}, {"min_score": 1.1}, {"base_url": "file:///etc/passwd"}])
def test_invalid_config_is_rejected(config):
    with pytest.raises(ValueError):
        RerankerFactory.create("qwen", {"api_key": "test-key", **config})
