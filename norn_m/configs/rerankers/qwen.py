from typing import Optional
from urllib.parse import urlsplit

from pydantic import Field, field_validator

from norn_m.configs.rerankers.base import BaseRerankerConfig


class QwenRerankerConfig(BaseRerankerConfig):
    model: str = Field(default="qwen3.7-text-rerank", min_length=1)
    base_url: str = "https://maas.qianwenaiapi.com/compatible-api/v1"
    timeout: float = Field(default=5.0, gt=0, le=30, allow_inf_nan=False)
    min_score: Optional[float] = Field(default=None, ge=0, le=1, allow_inf_nan=False)

    @field_validator("base_url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        parts = urlsplit(value)
        if parts.scheme not in ("http", "https") or not parts.hostname or parts.username or parts.password:
            raise ValueError("base_url must be an http(s) URL without credentials")
        if parts.query or parts.fragment:
            raise ValueError("base_url must not contain a query or fragment")
        return value.rstrip("/")

    model_config = {"extra": "forbid"}
