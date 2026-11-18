import json

import httpx
import pytest

from norn_m.embeddings.configs import EmbedderConfig
from norn_m.embeddings.jina import MAX_BATCH, JinaEmbeddingError
from norn_m.utils.factory import EmbedderFactory


@pytest.fixture
def make_embedder(monkeypatch):
    monkeypatch.setenv("JINA_API_KEY", "test-token")
    config = EmbedderConfig(provider="jina", config={"embedding_dims": 2})

    def make(handler):
        embedder = EmbedderFactory.create(config.provider, config.config, None)
        embedder.close()
        embedder.client = httpx.Client(
            transport=httpx.MockTransport(handler), headers={"Authorization": "Bearer test-token"}
        )
        return embedder

    return make


def test_search_and_index_use_same_task_and_batched_vectors_stay_in_order(make_embedder):
    batches = []

    def respond(request):
        assert str(request.url) == "https://api.jina.ai/v1/embeddings"
        assert request.headers["Authorization"] == "Bearer test-token"
        body = json.loads(request.content)
        assert body["task"] == "text-matching"
        assert body["dimensions"] == 2
        assert body["model"] == "jina-embeddings-v4"
        values = [int(item["text"]) for item in body["input"]]
        batches.append(len(values))
        return httpx.Response(
            200, json={"data": [{"index": i, "embedding": [values[i], 1.0]} for i in reversed(range(len(values)))]}
        )

    embedder = make_embedder(respond)
    texts = [str(i) for i in range(MAX_BATCH + 1)]
    assert embedder.embed_batch(texts) == [[i, 1.0] for i in range(len(texts))]
    assert embedder.embed("7", "search") == [7, 1.0]
    assert batches == [MAX_BATCH, 1, 1]


@pytest.mark.parametrize(
    "data",
    [
        [{"index": 0, "embedding": [1, 0]}],
        [{"index": 0, "embedding": [1, 0]}, {"index": 0, "embedding": [0, 1]}],
        [{"index": 0, "embedding": [1, 0]}, {"index": 1, "embedding": [1]}],
        [{"index": 0, "embedding": [1, 0]}, {"index": 1, "embedding": [0, 0]}],
    ],
)
def test_invalid_batch_is_rejected_instead_of_misaligning_memories(make_embedder, data):
    embedder = make_embedder(lambda _: httpx.Response(200, json={"data": data}))
    with pytest.raises(JinaEmbeddingError, match="invalid embedding data"):
        embedder.embed_batch(["first", "second"])


@pytest.mark.parametrize(("status", "retryable"), [(401, False), (429, True), (503, True)])
def test_error_does_not_expose_upstream_body(make_embedder, status, retryable):
    embedder = make_embedder(lambda _: httpx.Response(status, text="private upstream response"))
    with pytest.raises(JinaEmbeddingError, match=rf"^Jina embeddings returned HTTP {status}$") as error:
        embedder.embed("private memory", "search")
    assert error.value.retryable is retryable


def test_connection_timeout_is_retryable(make_embedder):
    def timeout(request):
        raise httpx.ConnectTimeout("private request context")

    with pytest.raises(JinaEmbeddingError, match="connection failed or timed out") as error:
        make_embedder(timeout).embed("private memory", "search")
    assert error.value.retryable
