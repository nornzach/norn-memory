"""Live checks for an LLM / embedder configuration before (or without) applying it.

Each check builds the provider straight from its factory, so nothing touches the vector
store or the running Memory instance, and makes one small real request.
"""

import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from typing import Any, Callable, Dict, Optional

from norn_m.utils.factory import EmbedderFactory, LlmFactory

CHECK_TIMEOUT_SECONDS = 30
MAX_ERROR_LENGTH = 300

# Checks run on their own threads so a hung endpoint can't hold the request past the timeout.
_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="config-check")


def _short_error(exc: BaseException) -> str:
    message = str(exc) or exc.__class__.__name__
    return message if len(message) <= MAX_ERROR_LENGTH else message[: MAX_ERROR_LENGTH - 1] + "…"


def _timed(probe: Callable[[], Any]) -> Dict[str, Any]:
    start = time.perf_counter()
    try:
        value = _executor.submit(probe).result(timeout=CHECK_TIMEOUT_SECONDS)
    except FutureTimeout:
        return {"ok": False, "error": f"No response within {CHECK_TIMEOUT_SECONDS} seconds.", "value": None}
    except Exception as exc:
        return {"ok": False, "error": _short_error(exc), "value": None}
    return {"ok": True, "error": None, "value": value, "latency_ms": round((time.perf_counter() - start) * 1000)}


def check_llm(section: Dict[str, Any]) -> Dict[str, Any]:
    def probe():
        llm = LlmFactory.create(section["provider"], dict(section.get("config") or {}))
        return llm.generate_response([{"role": "user", "content": "Reply with the single word OK."}])

    result = _timed(probe)
    return {"ok": result["ok"], "error": result["error"], "latency_ms": result.get("latency_ms")}


def check_embedder(section: Dict[str, Any], expected_dims: Optional[int]) -> Dict[str, Any]:
    def probe():
        embedder = EmbedderFactory.create(section["provider"], dict(section.get("config") or {}), None)
        return len(embedder.embed("connection test", "search"))

    result = _timed(probe)
    dims = result["value"]
    error = result["error"]
    if result["ok"] and expected_dims and dims != expected_dims:
        error = (
            f"The model returns {dims}-dimensional vectors, but the vector store expects {expected_dims}. "
            "Pick a model with that size, set embedding dimensions if the API supports it, "
            "or recreate the vector store with NORN_M_DEFAULT_EMBEDDER_DIMS."
        )
    return {
        "ok": error is None,
        "error": error,
        "latency_ms": result.get("latency_ms"),
        "dims": dims,
        "expected_dims": expected_dims,
    }


def expected_embedding_dims(config: Dict[str, Any]) -> Optional[int]:
    vector_config = (config.get("vector_store") or {}).get("config") or {}
    dims = vector_config.get("embedding_model_dims")
    return int(dims) if dims else None
