import math
import os

import httpx

from norn_m.embeddings.base import EmbeddingBase

ENDPOINT = "https://api.jina.ai/v1/embeddings"
MODEL = "jina-embeddings-v4"
MAX_BATCH = 32


class JinaEmbeddingError(RuntimeError):
    def __init__(self, message: str, *, retryable: bool = False):
        super().__init__(message)
        self.retryable = retryable


class JinaEmbedding(EmbeddingBase):
    """Text embeddings for both stored memories and queries via Jina's native API."""

    def __init__(self, config=None):
        super().__init__(config)
        self.config.model = self.config.model or MODEL
        self.config.embedding_dims = self.config.embedding_dims or 768
        key = self.config.api_key or os.getenv("JINA_API_KEY")
        if not key:
            raise ValueError("Jina embeddings require api_key or JINA_API_KEY")
        self.client = httpx.Client(
            headers={"Authorization": f"Bearer {key}"},
            timeout=httpx.Timeout(12.0, connect=5.0),
        )

    def close(self) -> None:
        self.client.close()

    def _embed_batch(self, texts):
        try:
            response = self.client.post(
                ENDPOINT,
                json={
                    "model": self.config.model,
                    "task": "text-matching",
                    "dimensions": self.config.embedding_dims,
                    "input": [{"text": text} for text in texts],
                },
            )
        except httpx.RequestError:
            raise JinaEmbeddingError("Jina embedding connection failed or timed out", retryable=True) from None
        if response.status_code != 200:
            status = response.status_code
            raise JinaEmbeddingError(
                f"Jina embeddings returned HTTP {status}", retryable=status == 429 or status >= 500
            )
        try:
            rows = response.json()["data"]
            if not isinstance(rows, list) or len(rows) != len(texts):
                raise ValueError
            result = {}
            for row in rows:
                index, vector = row["index"], row["embedding"]
                if type(index) is not int or not 0 <= index < len(texts) or index in result:
                    raise ValueError
                if (
                    not isinstance(vector, list)
                    or len(vector) != self.config.embedding_dims
                    or not all(type(value) in (float, int) and math.isfinite(value) for value in vector)
                    or not any(vector)
                ):
                    raise ValueError
                result[index] = vector
        except (KeyError, TypeError, ValueError, OverflowError):
            raise JinaEmbeddingError("Jina returned invalid embedding data") from None
        return [result[index] for index in range(len(texts))]

    def embed(self, text, memory_action=None):
        return self._embed_batch([text])[0]

    def embed_batch(self, texts, memory_action="add"):
        result = []
        for start in range(0, len(texts), MAX_BATCH):
            result.extend(self._embed_batch(texts[start : start + MAX_BATCH]))
        return result
