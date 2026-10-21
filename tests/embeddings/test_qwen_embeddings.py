from unittest.mock import Mock, patch

import pytest

from norn_m.configs.embeddings.base import BaseEmbedderConfig
from norn_m.embeddings.configs import EmbedderConfig
from norn_m.embeddings.qwen import DEFAULT_BASE_URL, QwenEmbedding
from norn_m.utils.factory import EmbedderFactory


@pytest.fixture
def mock_openai():
    with patch("norn_m.embeddings.qwen.OpenAI") as mock_openai:
        mock_openai.return_value = Mock()
        yield mock_openai


def _response(vectors, order=None):
    order = order or range(len(vectors))
    return Mock(data=[Mock(embedding=vectors[i], index=i) for i in order])


def test_defaults_and_dimensions_always_sent(mock_openai, monkeypatch):
    monkeypatch.delenv("DASHSCOPE_API_KEY", raising=False)
    monkeypatch.delenv("DASHSCOPE_BASE_URL", raising=False)
    embedder = QwenEmbedding(BaseEmbedderConfig(api_key="sk-test"))
    client = mock_openai.return_value
    client.embeddings.create.return_value = _response([[0.1, 0.2]])

    assert embedder.embed("Hello\nworld") == [0.1, 0.2]

    mock_openai.assert_called_once_with(api_key="sk-test", base_url=DEFAULT_BASE_URL)
    client.embeddings.create.assert_called_once_with(
        input=["Hello world"], model="qwen3.7-text-embedding", dimensions=1024, encoding_format="float"
    )


def test_configured_model_dims_and_base_url(mock_openai):
    config = BaseEmbedderConfig(
        model="text-embedding-v4", api_key="sk-test", embedding_dims=768, qwen_base_url="https://example.test/v1"
    )
    embedder = QwenEmbedding(config)
    client = mock_openai.return_value
    client.embeddings.create.return_value = _response([[0.3]])

    embedder.embed("x")

    mock_openai.assert_called_once_with(api_key="sk-test", base_url="https://example.test/v1")
    assert client.embeddings.create.call_args.kwargs["dimensions"] == 768
    assert client.embeddings.create.call_args.kwargs["model"] == "text-embedding-v4"


def test_key_and_base_url_from_environment(mock_openai, monkeypatch):
    monkeypatch.setenv("DASHSCOPE_API_KEY", "sk-env")
    monkeypatch.setenv("DASHSCOPE_BASE_URL", "https://dashscope-intl.example/v1")

    QwenEmbedding(BaseEmbedderConfig())

    mock_openai.assert_called_once_with(api_key="sk-env", base_url="https://dashscope-intl.example/v1")


def test_embed_batch_chunks_by_ten_and_keeps_order(mock_openai):
    embedder = QwenEmbedding(BaseEmbedderConfig(api_key="sk-test", embedding_dims=4))
    client = mock_openai.return_value
    texts = [f"text {i}" for i in range(23)]

    def create(input, **kwargs):
        # Return each chunk out of order: results must still line up with the inputs.
        vectors = [[float(texts.index(t))] for t in input]
        return _response(vectors, order=reversed(range(len(vectors))))

    client.embeddings.create.side_effect = create

    result = embedder.embed_batch(texts)

    assert [len(call.kwargs["input"]) for call in client.embeddings.create.call_args_list] == [10, 10, 3]
    assert result == [[float(i)] for i in range(23)]


def test_embed_batch_rejects_short_response(mock_openai):
    embedder = QwenEmbedding(BaseEmbedderConfig(api_key="sk-test"))
    mock_openai.return_value.embeddings.create.return_value = _response([[0.1]])

    with pytest.raises(ValueError, match="returned 1 embeddings for 2 texts"):
        embedder.embed_batch(["a", "b"])


def test_provider_is_registered(mock_openai):
    assert EmbedderConfig(provider="qwen", config={"api_key": "sk-test"}).provider == "qwen"
    embedder = EmbedderFactory.create("qwen", {"api_key": "sk-test", "embedding_dims": 768}, None)
    assert isinstance(embedder, QwenEmbedding)
    assert embedder.config.embedding_dims == 768
