import math
import os

import httpx

from norn_m.configs.rerankers.jina import JINA_MAX_CANDIDATES
from norn_m.reranker.base import BaseReranker


class JinaReranker(BaseReranker):
    """Jina's native rerank API, with relevance scores that can be negative."""

    def __init__(self, config):
        self.config = config
        key = config.api_key or os.getenv("JINA_API_KEY")
        if not key:
            raise ValueError("Jina reranker requires api_key or JINA_API_KEY")
        self.client = httpx.Client(headers={"Authorization": f"Bearer {key}"}, timeout=config.timeout)

    def close(self):
        self.client.close()

    def rerank(self, query, documents, top_k=None):
        if not documents:
            return []
        if len(documents) > JINA_MAX_CANDIDATES:
            raise ValueError(f"Jina reranker accepts at most {JINA_MAX_CANDIDATES} documents")
        try:
            response = self.client.post(
                "https://api.jina.ai/v1/rerank",
                json={
                    "model": self.config.model,
                    "query": query,
                    "documents": [doc["memory"] for doc in documents],
                    "top_n": len(documents),
                    "return_documents": False,
                },
            )
        except httpx.TimeoutException:
            raise RuntimeError("Jina reranker timed out") from None
        except httpx.HTTPError:
            raise RuntimeError("Jina reranker connection failed") from None
        if response.status_code != 200:
            raise RuntimeError(f"Jina reranker returned HTTP {response.status_code}")
        try:
            rows = response.json()["results"]
            if not isinstance(rows, list) or len(rows) != len(documents):
                raise ValueError
            scores = {}
            for row in rows:
                index, score = row["index"], row["relevance_score"]
                if type(index) is not int or not 0 <= index < len(documents) or index in scores:
                    raise ValueError
                if type(score) not in (float, int) or not math.isfinite(score):
                    raise ValueError
                scores[index] = float(score)
        except (ValueError, TypeError, KeyError, OverflowError):
            raise ValueError("Invalid Jina reranker response") from None
        ordered = sorted(scores.items(), key=lambda item: (-item[1], item[0]))
        ranked = [
            {**documents[index], "rerank_score": score}
            for index, score in ordered
            if self.config.min_score is None or score >= self.config.min_score
        ]
        limit = top_k if top_k is not None else self.config.top_k
        return ranked if limit is None else ranked[:limit]
