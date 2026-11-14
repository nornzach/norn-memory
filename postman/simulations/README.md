# Qwen rerank HTTP verification

Start the local stand-ins from the repository root:

```sh
postman simulation run postman/simulations/qwen-reranker.sim.yaml --port 4019 --no-history --output ndjson
```

In a Hatch environment with the SDK and test dependencies installed, run:

```sh
QWEN_SIMULATION_URL=http://127.0.0.1:4019 hatch run python -m pytest tests/rerankers/test_qwen_http_simulation.py -q
```

The opt-in test is skipped unless the URL is set. It checks success, 503, delayed response and invalid index fallback with actual HTTP, using a synthetic key. The `qwen` member also serves deterministic 8-dimensional embeddings for isolated server testing; it is not a model quality benchmark. Unmodeled routes return 501. Read `qwen-reranker.context.yaml` for evidence and unresolved assumptions.
