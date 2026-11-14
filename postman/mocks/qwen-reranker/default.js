// Synthetic ranking fixtures, based on the gateway's observed index/score response contract.
const http = require("http");
http.createServer((req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.method !== "POST") return send(501, { error: "Not modeled" });
  const body = req.body;
  if (req.url === "/compatible-api/v1/embeddings") {
    // OpenAI-compatible synthetic vectors for isolated server verification only.
    const inputs = Array.isArray(body.input) ? body.input : [body.input];
    return send(200, { object: "list", model: body.model, data: inputs.map((_, index) => ({
      object: "embedding", index, embedding: [1, 0, 0, 0, 0, 0, 0, 0],
    })), usage: { prompt_tokens: 1, total_tokens: 1 } });
  }
  if (req.url !== "/compatible-api/v1/reranks") return send(501, { error: "Not modeled" });
  if (!body || typeof body.query !== "string" || !Array.isArray(body.documents) ||
      body.top_n !== body.documents.length || body.return_documents !== false) {
    return send(400, { error: "Invalid rerank request" });
  }
  if (body.query === "malformed-response-fixture") return send(200, { results: [{ index: 999, relevance_score: 0.9 }] });
  const results = body.documents.map((text, index) => ({
    index, relevance_score: /green tea|绿茶/.test(text) ? 0.95 : 0.2,
  })).sort((a, b) => b.relevance_score - a.relevance_score);
  send(200, { results, usage: { prompt_tokens: 10, total_tokens: 10 } });
}).listen(process.env.PORT || 4500);
