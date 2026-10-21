import os
from typing import Literal, Optional

from openai import OpenAI

from norn_m.configs.embeddings.base import BaseEmbedderConfig
from norn_m.embeddings.base import EmbeddingBase

DEFAULT_BASE_URL = "https://maas.qianwenaiapi.com/compatible-mode/v1"
# The compatible-mode endpoint rejects more than 10 inputs per request.
MAX_BATCH = 10


class QwenEmbedding(EmbeddingBase):
    """Qwen (Qianwen / DashScope) text embeddings through the OpenAI-compatible endpoint."""

    def __init__(self, config: Optional[BaseEmbedderConfig] = None):
        super().__init__(config)

        self.config.model = self.config.model or "qwen3.7-text-embedding"
        # Qwen embedding models take a dimensions parameter (qwen3.7: 256 to 2560), so it is always
        # sent: the vectors then match the vector store whatever the model's own default is.
        self.config.embedding_dims = self.config.embedding_dims or 1024

        api_key = self.config.api_key or os.getenv("DASHSCOPE_API_KEY")
        base_url = self.config.qwen_base_url or os.getenv("DASHSCOPE_BASE_URL") or DEFAULT_BASE_URL
        self.client = OpenAI(api_key=api_key, base_url=base_url)

    def _create(self, texts):
        return self.client.embeddings.create(
            input=texts,
            model=self.config.model,
            dimensions=self.config.embedding_dims,
            encoding_format="float",
        )

    def embed(self, text, memory_action: Optional[Literal["add", "search", "update"]] = None):
        """
        Get the embedding for the given text using Qwen.

        Args:
            text (str): The text to embed.
            memory_action (optional): The type of embedding to use. Must be one of "add", "search", or "update". Defaults to None.
        Returns:
            list: The embedding vector.
        """
        return self._create([text.replace("\n", " ")]).data[0].embedding

    def embed_batch(self, texts, memory_action="add"):
        """Embed multiple texts, in chunks of 10 (the endpoint's limit per request)."""
        texts = [text.replace("\n", " ") for text in texts]
        all_embeddings = []
        for i in range(0, len(texts), MAX_BATCH):
            response = self._create(texts[i : i + MAX_BATCH])
            all_embeddings.extend(item.embedding for item in sorted(response.data, key=lambda x: x.index))
        if len(all_embeddings) != len(texts):
            raise ValueError(
                f"Qwen embed_batch() returned {len(all_embeddings)} embeddings for {len(texts)} texts"
                f" using model '{self.config.model}'"
            )
        return all_embeddings
