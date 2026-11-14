import math
import os
from typing import Any, Dict, List

import httpx

from norn_m.reranker.base import BaseReranker


class QwenReranker(BaseReranker):
    """Qwen's compatible /reranks API. Failures are handled by the search caller."""

    def __init__(self, config):
        self.config = config
        key = config.api_key or os.getenv("QWEN_RERANK_API_KEY")
        if not key:
            raise ValueError("Qwen reranker requires api_key or QWEN_RERANK_API_KEY")
        self.client = httpx.Client(
            headers={"Authorization": f"Bearer {key}"},
            timeout=config.timeout,
            follow_redirects=False,
        )

    def close(self):
        self.client.close()

    def rerank(self, query: str, documents: List[Dict[str, Any]], top_k: int = None) -> List[Dict[str, Any]]:
        if not documents:
            return []
        try:
            response = self.client.post(
                f"{self.config.base_url}/reranks",
                json={
                    "model": self.config.model,
                    "query": query,
                    "documents": [doc["memory"] for doc in documents],
                    # Request every score so validation and optional rejection are unambiguous.
                    "top_n": len(documents),
                    "return_documents": False,
                },
            )
        except httpx.TimeoutException:
            raise RuntimeError("Qwen reranker timed out") from None
        except httpx.HTTPError:
            raise RuntimeError("Qwen reranker connection failed") from None
        if response.status_code != 200:
            raise RuntimeError(f"Qwen reranker returned HTTP {response.status_code}")
        try:
            body = response.json()
            rows = body.get("results") if isinstance(body, dict) else None
            if not isinstance(rows, list) or len(rows) != len(documents):
                raise ValueError
            seen = set()
            scored = []
            for row in rows:
                index, score = row["index"], row["relevance_score"]
                if type(index) is not int or not 0 <= index < len(documents) or index in seen:
                    raise ValueError
                if type(score) not in (float, int) or not math.isfinite(score) or not 0 <= score <= 1:
                    raise ValueError
                seen.add(index)
                scored.append((index, float(score)))
        except (ValueError, TypeError, KeyError):
            raise ValueError("Invalid Qwen reranker response") from None
        scored.sort(key=lambda item: (-item[1], item[0]))
        limit = top_k if top_k is not None else self.config.top_k
        ranked = [
            {**documents[index], "rerank_score": score}
            for index, score in scored
            if self.config.min_score is None or score >= self.config.min_score
        ]
        return ranked if limit is None else ranked[:limit]
