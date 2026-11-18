from typing import Optional

from pydantic import Field

from norn_m.configs.rerankers.base import BaseRerankerConfig

JINA_MAX_CANDIDATES = 64


class JinaRerankerConfig(BaseRerankerConfig):
    model: str = Field(default="jina-reranker-v3", min_length=1)
    timeout: float = Field(default=5.0, gt=0, le=30, allow_inf_nan=False)
    min_score: Optional[float] = Field(default=None, ge=-1, le=1, allow_inf_nan=False)

    model_config = {"extra": "forbid"}
