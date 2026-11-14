"""Opt-in real HTTP checks: start postman/simulations/qwen-reranker.sim.yaml first."""

import os
import time

import pytest

from norn_m.memory.main import _finish_search
from norn_m.utils.factory import RerankerFactory

SIMULATION = os.getenv("QWEN_SIMULATION_URL")
pytestmark = pytest.mark.skipif(not SIMULATION, reason="QWEN_SIMULATION_URL is not set")


@pytest.mark.parametrize(
    "route,query,status,expected",
    [
        ("qwen", "drink", "applied", "tea"),
        ("unavailable", "drink", "fallback", "coffee"),
        ("slow", "drink", "fallback", "coffee"),
        ("qwen", "malformed-response-fixture", "fallback", "coffee"),
    ],
)
def test_search_outcome_with_real_http(route, query, status, expected):
    reranker = RerankerFactory.create(
        "qwen",
        {
            "api_key": "synthetic-test-key",
            "base_url": f"{SIMULATION}/{route}/compatible-api/v1",
            "timeout": 0.2,
        },
    )
    candidates = [
        {"id": "coffee", "memory": "Coffee", "score": 0.9},
        {"id": "tea", "memory": "User prefers green tea", "score": 0.7},
    ]
    start = time.perf_counter()
    try:
        result = _finish_search(query, candidates, reranker, 1, 60, True)
    finally:
        reranker.close()
    assert result["rerank"]["status"] == status
    assert result["results"][0]["id"] == expected
    assert time.perf_counter() - start < 2
    assert ("rerank_score" in result["results"][0]) == (status == "applied")
