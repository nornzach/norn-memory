# Qwen reranking

The Python SDK supports `qwen3.7-text-rerank` through the `qwen` provider. It sends the query and candidate **memory text** to a compatible rerank API; IDs, original scores and metadata are preserved locally. This provider uses the existing `httpx` dependency.

## Configure Python

Set `QWEN_RERANK_API_KEY` in the environment, then add a reranker to your existing memory configuration:

```python
from norn_m import Memory

memory = Memory.from_config({
    "reranker": {
        "provider": "qwen",
        "enabled": True,
        "candidate_pool_size": 60,
        "config": {
            "model": "qwen3.7-text-rerank",
            "base_url": "https://maas.qianwenaiapi.com/compatible-api/v1",
            "timeout": 5.0,
            "min_score": None,
        },
    },
})

result = memory.search(
    "Which database did we choose for production?",
    filters={"user_id": "alice", "project": "atlas"},
    top_k=5,
    rerank=True,
    explain=True,
)
```

The same configuration and search parameters work with `AsyncMemory`; await its `search` method. SDK searches keep `rerank=False` as their default. Setting `enabled=False` avoids constructing the configured provider, even if a request asks for reranking.

This gateway accepts **POST `/compatible-api/v1/reranks`**. Its embedding/chat base `/compatible-mode/v1` does not expose this rerank route. For another compatible service, set its base URL; the provider appends `/reranks`.

| Setting | Default | Meaning |
| --- | --- | --- |
| `candidate_pool_size` | `60` | Maximum documents sent to the provider; integer 1–500. It also bounds each recall source. |
| `config.api_key` | Environment | API key, or `QWEN_RERANK_API_KEY` when absent. |
| `config.timeout` | `5.0` | HTTP connect/read/write/pool timeout in seconds, greater than 0 and at most 30. No application retries. |
| `config.min_score` | `null` | Optional 0–1 rejection threshold applied only after a valid successful response. |

## Candidate selection and fallback

For reranked searches, Norn-M retrieves vector and keyword candidates using the same filters, excludes expired memories unless requested, applies context isolation to both recall sources, and deduplicates by memory ID. A positive lexical hit can enter the candidate set even when its semantic score is below `threshold`. Vector-only candidates still have to meet that threshold.

Reciprocal rank fusion of the two recall lists selects up to `candidate_pool_size` candidates. Qwen scores that pool, and only then does Norn-M apply the final `top_k`. Returned results can therefore differ from the non-reranked top-k. A pool smaller than `top_k` can return fewer results. Stores without keyword search use vector candidates alone.

Even a single candidate is scored when reranking is enabled. There is no minimum candidate-count activation threshold. An empty pool makes no provider request.

The original hybrid `score` is preserved. `rerank_score` is added on success. With `explain=True`, the response also includes:

```json
{
  "results": [],
  "rerank": {"status": "applied", "candidate_count": 12, "latency_ms": 420}
}
```

The example is illustrative. Status is `applied`, `fallback`, `empty`, or `disabled`. Invalid/incomplete responses, timeouts and HTTP errors fall back to the eligible vector candidates in their original hybrid order (including hierarchy boosts), capped at `top_k`, without fabricated rerank scores. The optional `min_score` is not applied to fallback results. A successful response where every candidate scores below `min_score` returns an empty result list.

Rerank scores measure relevance, not factual correctness. They do not resolve outdated memories, wrong people or conflicting environments by themselves. Leave the score threshold off until evaluated with representative queries, including queries with no answer, and enforce project/user permissions before ranking.

## Self-hosted REST, MCP and dashboard

In **Configuration → Qwen Reranker**, enter the model, rerank base URL and key, test the connection, then save. The section has its own save button. Saving an enabled changed configuration runs a small synthetic probe first. Connection testing and saving do not create memories.

Once configured and enabled, ordinary REST `/search` and MCP `search_memories` use reranking by default. Pass `rerank=false` to opt out on an individual request, or `explain=true` to inspect its status. Before any external call, the server checks exact folder provenance and API-key scopes on each candidate. Exact records, `exact_get`, memory writes, entity matching and consolidation do not use this reranker.

A `POST /configure/test` body containing only `reranker` tests just that section. A `POST /configure` body may likewise update only that section. Omit `api_key` to retain the saved key; changing the provider or base URL drops the previous saved key. Configuration responses redact keys.

```json
{
  "reranker": {
    "provider": "qwen",
    "enabled": true,
    "candidate_pool_size": 60,
    "config": {
      "model": "qwen3.7-text-rerank",
      "base_url": "https://maas.qianwenaiapi.com/compatible-api/v1",
      "timeout": 5,
      "min_score": null
    }
  }
}
```

This example uses the server's `QWEN_RERANK_API_KEY`. Supply `config.api_key` through your private configuration channel if no environment key is set.
