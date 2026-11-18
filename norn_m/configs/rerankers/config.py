from typing import Optional

from pydantic import BaseModel, Field, model_validator

from norn_m.configs.rerankers.jina import JINA_MAX_CANDIDATES


class RerankerConfig(BaseModel):
    """Configuration for rerankers."""

    provider: str = Field(description="Reranker provider (e.g., 'cohere', 'sentence_transformer')", default="cohere")
    config: Optional[dict] = Field(description="Provider-specific reranker configuration", default=None)
    enabled: bool = Field(default=True, description="Enable this configured reranker")
    candidate_pool_size: int = Field(default=60, ge=1, le=500, description="Maximum candidates sent for reranking")

    model_config = {"extra": "forbid"}

    @model_validator(mode="after")
    def validate_pool_size(self):
        if self.provider == "jina" and self.candidate_pool_size > JINA_MAX_CANDIDATES:
            raise ValueError(f"Jina candidate_pool_size must be at most {JINA_MAX_CANDIDATES}")
        return self
