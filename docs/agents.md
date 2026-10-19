# Connecting agents

Agents connect to Norn-M over MCP at `http://<server>:8888/mcp`. Every agent configured with the same user ID reads and writes the same memories.

## The quick way

On the dashboard, open **API Keys** and click **Connect an agent** (or **Set up an agent with this key** right after creating one). Fill in the server URL, key, user ID, device and agent name, copy the prompt, and paste it into the agent. It checks the connection, registers the server as `norn-m` in its own configuration, and runs a test search.

The server URL must be reachable from the machine the agent runs on: use the server's LAN address for agents on other devices. The prompt contains the API key in plain text.

## Headers

| Header | Purpose |
|---|---|
| `X-API-Key` | A per-user key (`nmsk_...`). Give each agent or device its own key, so you can revoke one without affecting the others |
| `X-Norn-M-User-Id` | Default user for tool calls that name no `user_id`, `agent_id` or `run_id` |
| `X-Norn-M-Device` | Where the agent runs: `mac`, `windows`, `linux`, `phone`, `web`, ... |
| `X-Norn-M-Agent` | Which agent it is: `claude-code`, `omp`, `devin`, ... |

Device and agent are recorded on every write. Agents also pass `project` and `cwd` per write; see [Provenance](api.md#provenance).

## Claude Code

```bash
claude mcp add --transport http --scope user norn-m http://localhost:8888/mcp \
  --header "X-API-Key: nmsk_your_key_here" \
  --header "X-Norn-M-User-Id: alice" \
  --header "X-Norn-M-Device: mac" \
  --header "X-Norn-M-Agent: claude-code"
```

Run `claude mcp list` to confirm it connects.

## Devin CLI

Add to `mcpServers` in `~/.config/devin/mcp_config.json`, then run `devin mcp get norn-m`:

```json
{
  "norn-m": {
    "url": "http://localhost:8888/mcp",
    "transport": "http",
    "headers": {
      "X-API-Key": "nmsk_your_key_here",
      "X-Norn-M-User-Id": "alice",
      "X-Norn-M-Device": "mac",
      "X-Norn-M-Agent": "devin"
    }
  }
}
```

## omp

Add to `mcpServers` in `~/.omp/agent/mcp.json`. Keep `"type": "http"`, or omp treats the entry as a local command:

```json
{
  "norn-m": {
    "type": "http",
    "url": "http://localhost:8888/mcp",
    "headers": {
      "X-API-Key": "nmsk_your_key_here",
      "X-Norn-M-User-Id": "alice",
      "X-Norn-M-Device": "mac",
      "X-Norn-M-Agent": "omp"
    }
  }
}
```

## Other agents

Add a remote MCP server named `norn-m` that uses streamable HTTP with the URL and headers above. Some clients call the type `"streamable-http"`.

## Using the memory

The MCP server's instructions tell agents how to use it; in short:

- Call `search_memories` before answering anything that depends on preferences, history, projects or earlier decisions.
- Save durable facts, preferences and decisions with `add_memory`, passing `project` and `cwd` when the memory belongs to the work at hand.
- Put anything that must come back exactly (passwords, keys, IPs, URLs, accounts, dates) in `exact_set` / `exact_get`, never in `add_memory`.

See the [tool list](api.md#mcp-for-agents) for every tool and argument.
