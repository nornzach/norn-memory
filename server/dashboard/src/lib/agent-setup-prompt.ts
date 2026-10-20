/**
 * The prompts the "Connect an agent" dialog builds for users to paste into an agent.
 *
 * A setup has four parts, and both prompts keep them in step:
 * - the MCP registration ("norn-m"), for the agent's own tool calls;
 * - ~/.norn-m/<agent>.json, the one place the hooks read the server address and key from;
 * - the hooks (server/agent_hooks/norn_m_hook.py), which add memories to every session and prompt and
 *   send each exchange back, so memory works without the agent deciding to call a tool;
 * - a marked block in the agent's global instructions with the rules for using memory.
 *
 * The setup prompt is safe to run again. The update prompt changes the address, key or user of an
 * existing setup in place, e.g. after the server gets a new IP address.
 */

export const KEY_PLACEHOLDER = "<PASTE_YOUR_NORN_M_API_KEY>";
const AGENT_PLACEHOLDER = "<agent>";
const HOOK_SCRIPT = "~/.norn-m/norn_m_hook.py";
const BEGIN_MARKER = "<!-- norn-m:begin -->";
const END_MARKER = "<!-- norn-m:end -->";

export interface AgentSetupValues {
  url: string;
  apiKey: string;
  userId: string;
  device: string;
  agent: string;
}

/** The REST base URL: the MCP endpoint without its trailing /mcp. */
export function restBaseUrl(mcpUrl: string): string {
  return mcpUrl
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/mcp$/, "");
}

function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line ? pad + line : line))
    .join("\n");
}

function settingsFile(agent: string): string {
  return `~/.norn-m/${agent}.json`;
}

function hookCommand(command: string, agent: string): string {
  return `python3 ${HOOK_SCRIPT} ${command} --agent ${agent}`;
}

function claudeHooks(agent: string): string {
  const entry = (command: string, timeout: number) => [
    {
      hooks: [
        { type: "command", command: hookCommand(command, agent), timeout },
      ],
    },
  ];
  return JSON.stringify(
    {
      hooks: {
        SessionStart: entry("session-start", 8),
        UserPromptSubmit: entry("recall", 5),
        Stop: entry("capture", 5),
      },
    },
    null,
    2,
  );
}

function instructionsBlock(userId: string): string {
  const user = userId
    ? `- My user_id is "${userId}". Use it on every norn-m call.`
    : "- Pass my user_id on every norn-m call; ask me for it if you don't know it.";
  return `${BEGIN_MARKER}
## Long-term memory (Norn-M)

You are connected to Norn-M, a long-term memory shared by all of my agents and devices (MCP server "norn-m").
- Memories are added to the conversation automatically at the start of each session and with my messages, inside <norn-m-memories> tags. Use them as background: they were stored earlier and can be out of date, and what I say now wins.
- When a task depends on my preferences, history, projects or earlier decisions and nothing relevant was added, call search_memories yourself before answering.
- Each exchange is also sent to Norn-M, which keeps the durable facts. When I state a preference or decision, or correct you, still save it with add_memory so it is recorded exactly as meant. Write memories so another agent understands them out of context, and pass project (the git repository's folder name) and cwd when they belong to the work at hand.
- Anything that must come back exactly (passwords, API keys, server IPs and logins, URLs, IDs, numbers, dates) goes in exact_set and exact_get, never add_memory, and you never repeat it in chat unless I ask.
${user}
- If the norn-m tools or hooks report that the server didn't answer or rejected the key, it may have moved or the key may have changed. Tell me, and ask for the "Update connection" prompt from the Norn-M dashboard (API Keys, then Connect an agent).
${END_MARKER}`;
}

function toolsListCheck(url: string, key: string): string {
  const listTools = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
  });
  return `curl -s -X POST ${url} -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -H "X-API-Key: ${key}" -d '${listTools}'`;
}

const PATH_NOTE =
  "Paths starting with ~ are in my home folder (%USERPROFILE% on Windows). Wherever a command is saved in a config file, write python3 and the script as absolute paths (use python on Windows if python3 doesn't exist).";

/** A prompt an agent follows to set itself up from scratch, or to bring an existing setup in line. */
export function buildAgentSetupPrompt(values: AgentSetupValues): string {
  const url = values.url.trim();
  const base = restBaseUrl(url);
  const key = values.apiKey.trim() || KEY_PLACEHOLDER;
  const userId = values.userId.trim();
  const device = values.device.trim();
  const agent = values.agent.trim() || AGENT_PLACEHOLDER;
  const agentUnknown = agent === AGENT_PLACEHOLDER;

  const headers: Record<string, string> = { "X-API-Key": key };
  if (userId) headers["X-Norn-M-User-Id"] = userId;
  if (device) headers["X-Norn-M-Device"] = device;
  headers["X-Norn-M-Agent"] = agent;

  const headerLines = Object.entries(headers)
    .map(([name, value]) => `  ${name}: ${value}`)
    .join("\n");
  const claudeHeaders = Object.entries(headers)
    .map(([name, value]) => `--header "${name}: ${value}"`)
    .join(" ");
  const devinEntry = JSON.stringify(
    { "norn-m": { url, transport: "http", headers } },
    null,
    2,
  );
  const ompEntry = JSON.stringify(
    { "norn-m": { type: "http", url, headers } },
    null,
    2,
  );
  const settings: Record<string, string> = { url: base, api_key: key };
  if (userId) settings.user_id = userId;
  if (device) settings.device = device;
  settings.agent = agent;

  return `Set yourself up to use my self-hosted Norn-M memory server: connect to it over MCP, install the memory hooks so memory is used in every session automatically, and add the memory rules to your global instructions. Then check that it all works.

This prompt is safe to run again. If any part of Norn-M is already set up for you (an MCP server named "norn-m", ${settingsFile(agent)}, hooks that run norn_m_hook.py, or a ${BEGIN_MARKER} block in your instructions), update that part in place with the values below. Never add a second copy.

## Values
- MCP endpoint (streamable HTTP): ${url}
- REST base URL: ${base}
- Headers to send on every MCP request:
${headerLines}
- Your agent name: ${agent}
${agentUnknown ? `  (Replace every ${AGENT_PLACEHOLDER} in this prompt with your own short lowercase name, such as claude-code, codex, devin or omp.)\n` : ""}
${PATH_NOTE}

## Steps
1. Check that the server is reachable and the key works. The reply should be JSON listing tools such as search_memories and exact_set:
   ${toolsListCheck(url, key)}
   If it fails, stop and tell me: a connection error means the URL is wrong or the server is down, and 401 means the key is wrong.

2. Save the connection settings to ${settingsFile(agent)} (create the folder if needed). The hooks read the server address and key from this file only, so it is the one file to change if the server moves. Make it readable only by me (chmod 600 on macOS and Linux):
${indent(JSON.stringify(settings, null, 2), 3)}

3. Register the server as "norn-m" in your own MCP configuration, at user (global) scope so it works in every project. Use the method for the agent you are:
   - Claude Code: run
     claude mcp add --transport http --scope user norn-m ${url} ${claudeHeaders}
     If "norn-m" already exists, run claude mcp remove norn-m --scope user first.
   - Devin CLI: add this entry under "mcpServers" in ~/.config/devin/mcp_config.json, then run devin mcp get norn-m:
${indent(devinEntry, 6)}
   - omp (oh-my-pi): add this entry under "mcpServers" in ~/.omp/agent/mcp.json. Keep "type": "http", or omp treats it as a local command:
${indent(ompEntry, 6)}
   - Any other agent: add a remote MCP server named "norn-m" that uses streamable HTTP with the URL and headers above, wherever your agent keeps its MCP configuration. If you are not sure where that is, ask me instead of guessing.
   When you edit a JSON config file, keep every server already in it and keep the file valid JSON. Create the file if it does not exist.

4. Install the memory hooks. They add relevant memories when a session starts and with each of my messages, and send each finished exchange back to Norn-M, so memory is used even when you don't think to call a tool.
   a. Download the hook script (a short, standard-library-only Python 3.8+ file; read it before installing):
      curl -fsS ${base}/agent-hooks/norn_m_hook.py -o ${HOOK_SCRIPT}
   b. Run ${hookCommand("check", agent)}
      It must print a line starting with "OK". If it doesn't, stop and tell me what it printed.
   c. Register three hooks:
      - Claude Code: merge these into "hooks" in ~/.claude/settings.json. Keep every hook already there: other tools may have hooks on the same events, so add these as extra entries next to theirs. Replace any existing entries whose command runs norn_m_hook.py.
${indent(claudeHooks(agent), 9)}
      - Other agents with lifecycle hooks (for example Codex CLI): run the same three commands on session start, on prompt submit and at the end of each turn, in your own hook format. The script prints Claude Code's hook JSON (hookSpecificOutput.additionalContext). If your hooks add plain stdout to the conversation instead, add --format text.
      - If you don't support hooks, skip this step and tell me. Memory then depends on the instructions in step 5.

5. Add the memory rules to your global instructions: the file you read at the start of every session in every project (Claude Code: ~/.claude/CLAUDE.md; Codex: ~/.codex/AGENTS.md; other agents: your own global rules file, and ask me if you are not sure which). Copy the block between the \`\`\` fences exactly, markers included. If the markers are already there, replace everything between them and leave the rest of the file alone:
\`\`\`markdown
${instructionsBlock(userId)}
\`\`\`

6. Confirm the server is registered with your own tooling (for example claude mcp list), and tell me whether I need to restart you to load the new tools, hooks and instructions. Once the norn-m tools are loaded, call search_memories with the query "setup check" to confirm they work. Do not store anything during setup.

Never repeat the API key back to me.`;
}

/** A prompt that moves an existing setup to a new address, key or user. Blank values stay as they are. */
export function buildAgentUpdatePrompt(values: AgentSetupValues): string {
  const url = values.url.trim();
  const base = restBaseUrl(url);
  const newKey = values.apiKey.trim();
  const userId = values.userId.trim();
  const device = values.device.trim();
  const agent = values.agent.trim() || AGENT_PLACEHOLDER;
  const agentUnknown = agent === AGENT_PLACEHOLDER;
  const keyForCheck = newKey || "<the api_key from the settings file>";

  const changes = [
    `- MCP endpoint (streamable HTTP): ${url}`,
    `- REST base URL: ${base}`,
    newKey
      ? `- API key: ${newKey}`
      : `- API key: unchanged. Use the api_key already in ${settingsFile(agent)} (or in your norn-m MCP headers if that file is missing), without printing it.`,
    userId ? `- User ID: ${userId}` : "- User ID: unchanged",
    device ? `- Device: ${device}` : "- Device: unchanged",
  ].join("\n");
  const otherFields = [
    newKey && "api_key",
    userId && "user_id",
    device && "device",
  ].filter(Boolean);
  const headerChanges = [
    newKey && "X-API-Key",
    userId && "X-Norn-M-User-Id",
    device && "X-Norn-M-Device",
  ].filter(Boolean);
  const plural = (n: number, word: string) => (n > 1 ? `${word}s` : word);

  const steps = [
    `Find your current setup: ${settingsFile(agent)}, the "norn-m" server in your MCP configuration, hooks that run norn_m_hook.py, and the ${BEGIN_MARKER} block in your global instructions. If none of them exist, stop and tell me to use the full setup prompt instead.`,
    `Check that the new address works with the key:
   ${toolsListCheck(url, keyForCheck)}
   If it fails, stop and tell me: a connection error means the address is wrong or the server is down, and 401 means the key is wrong. Change nothing in that case.`,
    `In ${settingsFile(agent)}, set url to ${base}${otherFields.length ? ` and ${otherFields.join(", ")} to the new ${plural(otherFields.length, "value")}` : ""}. Keep every other field, and keep the file readable only by me (chmod 600 on macOS and Linux).`,
    `Point the "norn-m" MCP server at ${url}${headerChanges.length ? ` and set the ${headerChanges.join(", ")} ${plural(headerChanges.length, "header")} to the new ${plural(headerChanges.length, "value")}` : ""}. Keep ${headerChanges.length ? "its other headers" : "its headers"} as they are.
   - Claude Code: run claude mcp get norn-m to see the current headers, then claude mcp remove norn-m --scope user, then claude mcp add --transport http --scope user norn-m ${url} with a --header "Name: value" option for each header.
   - Agents with a JSON config file: change only the norn-m entry, and keep the file valid JSON.`,
    `Download the hook script again from the new address, so it is the version this server ships:
   curl -fsS ${base}/agent-hooks/norn_m_hook.py -o ${HOOK_SCRIPT}
   The hook entries don't contain the address, so leave them alone. If they are missing, tell me, and I will send the full setup prompt.`,
    userId &&
      `In the ${BEGIN_MARKER} block of your global instructions, change the user_id to "${userId}".`,
    `Run ${hookCommand("check", agent)}
   It must print a line starting with "OK". Then tell me what you changed and whether I need to restart you.`,
  ].filter(Boolean);

  return `My Norn-M memory server's connection details changed. Update your existing Norn-M setup in place so every part of it uses the new values.

## New values
${changes}
- Your agent name: ${agent}
${agentUnknown ? `  (Replace every ${AGENT_PLACEHOLDER} in this prompt with the name you used when Norn-M was set up, such as claude-code, codex, devin or omp.)\n` : ""}
${PATH_NOTE}

## Steps
${steps.map((step, index) => `${index + 1}. ${step}`).join("\n\n")}

Never repeat the API key back to me.`;
}
