from typing import Optional

from pydantic import BaseModel, Field


class RerankerConfig(BaseModel):
    """Configuration for rerankers."""

    provider: str = Field(description="Reranker provider (e.g., 'cohere', 'sentence_transformer')", default="cohere")
    config: Optional[dict] = Field(description="Provider-specific reranker configuration", default=None)
    enabled: bool = Field(default=True, description="Enable this configured reranker")
    candidate_pool_size: int = Field(default=60, ge=1, le=500, description="Maximum candidates sent for reranking")

    model_config = {"extra": "forbid"}
