# Connecting agents

Agents connect to Norn-M over MCP at `http://<server>:8888/mcp`. Every agent configured with the same user ID reads and writes the same memories.

## The quick way

On the dashboard, open **API Keys** and click **Connect an agent** (or **Set up an agent with this key** right after creating one). Fill in the server URL, key, user ID, device and agent name, copy the prompt, and paste it into the agent. The agent then:

1. checks the connection;
2. saves the address and key to `~/.norn-m/<agent>.json`;
3. registers the server as `norn-m` in its own MCP configuration;
4. installs the [memory hooks](#memory-hooks), where the agent supports hooks;
5. adds the memory rules to its global instructions (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, ...) between `<!-- norn-m:begin -->` and `<!-- norn-m:end -->`.

The prompt is safe to run again: an agent that is already set up updates each part in place.

### Upgrade or repair an existing installation

Use **Upgrade / update connection** and leave the URL, key, user ID and device blank to retain them. The prompt preflights the saved connection, refreshes the shared `~/.norn-m/norn_m_hook.py`, repairs missing Norn-M registration or hook entries where possible, and replaces the marked rules in each agent's global instructions. Other MCP servers, hooks and instructions stay in place. If required settings cannot be recovered, supply them before proceeding. Start a new agent session to load the updated configuration, then verify the three read routes (`action`, `history`, `legacy`). No test writes are needed.

The server URL must be reachable from the machine the agent runs on: use the server's LAN address for agents on other devices, or a hostname such as `my-mac.local`, which survives IP address changes. The prompt contains the API key in plain text.

### When the server moves or the key changes

Use **Upgrade / update connection**, fill in only the changed values, and paste the prompt into each agent. It keeps the local hook settings and MCP entry in sync. An unchanged key never appears in the prompt: the agent reuses the one it already has.

When the server stops answering or rejects the key, the session-start hook says so in the conversation, and the agent asks you for the update prompt.

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
- Use `action` for current rules and procedures, `history` for dated memories and cases, and `resume` for a specific task handoff. When a historical question gets no relevant `history` hit, use `legacy` in the same project and user scope. Use `legacy` directly for raw memories or filters such as memory layer. Treat those results as historical, and use `get_memory` with a knowledge entry's `memory_id` to verify its source when needed. This fallback is an instruction for the agent, not an extra query made by the hook.
- Save durable facts, preferences and decisions with `add_memory`, passing `project` and `cwd` when the memory belongs to the work at hand.
- Put anything that must come back exactly (passwords, keys, IPs, URLs, accounts, dates) in `exact_set` / `exact_get`, never in `add_memory`.

See the [tool list](api.md#mcp-for-agents) for every tool and argument.

Left to themselves, agents often skip those calls. The memory hooks and the instructions block make memory part of every session instead.

## Memory hooks

`norn_m_hook.py` is a standard-library Python 3.8+ script that the server serves at `/agent-hooks/norn_m_hook.py`. The setup prompt saves it to `~/.norn-m/` and registers it with the agent:

| Hook | Command | What it does |
|------|---------|--------------|
| Session start | `session-start` | Adds the memories that best describe the user and the current project (the git repository's folder name). If the server doesn't answer or rejects the key, adds a short note saying so instead. |
| Prompt submit | `recall` | Normally searches current knowledge. Recognized historical questions (e.g. “what happened” or “上次”) request dated memories and curated cases instead. Vector hits must meet `min_score` (default 0.5); short nonhistorical prompts and slash commands are skipped. |
| End of turn | `capture` | Submits the exchange. A grounded incident, decision or outcome can appear in **Memories** even if no reusable knowledge is published. The curator may independently publish supported knowledge, or keep neither. The hook runs detached. |
| — | `check` | Tests the connection and prints `OK: ...`, for setup. |

Each command takes `--agent <name>` and reads `~/.norn-m/<name>.json`:

```json
{"url": "http://192.168.1.20:8888", "api_key": "nmsk_...", "user_id": "alice", "device": "mac", "agent": "claude-code", "min_score": 0.5}
```

Output is Claude Code's hook JSON (`hookSpecificOutput.additionalContext`); add `--format text` for agents whose hooks add plain stdout to the conversation. Memories arrive inside `<norn-m-memories>` tags. Exact records are never added automatically. Every request has a short timeout and every failure is silent (apart from the session-start note), so a hook can't block the agent. Calls bypass any system HTTP proxy, since the server is on the same machine or network.

To remove the hooks, delete the entries that run `norn_m_hook.py` from the agent's hook settings, and delete `~/.norn-m/`.
