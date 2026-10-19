"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { CopyToClipboard } from "react-copy-to-clipboard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/utils/api";
import { ENTITY_ENDPOINTS } from "@/utils/api-endpoints";
import { useApiQuery } from "@/hooks/use-api-query";
import { Entity } from "@/types/api";
import { useI18n } from "@/i18n/provider";

const KEY_PLACEHOLDER = "<PASTE_YOUR_NORN_M_API_KEY>";
const AGENT_PLACEHOLDER =
  "<your own short lowercase name, e.g. claude-code, omp, devin>";
const DEVICE_SUGGESTIONS = [
  "mac",
  "windows",
  "linux",
  "phone",
  "web",
  "server",
];
const AGENT_SUGGESTIONS = [
  "claude-code",
  "omp",
  "devin",
  "codex",
  "cursor",
  "hermes",
];

/** The MCP URL agents should use. The dashboard's API URL often says localhost, which only works
 * on this machine, so when the dashboard itself was opened by LAN address or hostname, use that. */
function defaultMcpUrl(): string {
  if (typeof window === "undefined") return "";
  const configured = process.env.NEXT_PUBLIC_API_URL;
  const { protocol, hostname } = window.location;
  try {
    const url = new URL(configured || `${protocol}//${hostname}:8888`);
    const local = ["localhost", "127.0.0.1", "[::1]"];
    if (local.includes(url.hostname) && !local.includes(hostname)) {
      url.hostname = hostname;
    }
    return `${url.origin}/mcp`;
  } catch {
    return `${protocol}//${hostname}:8888/mcp`;
  }
}

function guessDevice(): string {
  if (typeof navigator === "undefined") return "";
  const platform = `${navigator.platform} ${navigator.userAgent}`;
  if (/iPhone|iPad|Android/i.test(platform)) return "phone";
  if (/Mac/i.test(platform)) return "mac";
  if (/Win/i.test(platform)) return "windows";
  if (/Linux/i.test(platform)) return "linux";
  return "";
}

export interface AgentSetupValues {
  url: string;
  apiKey: string;
  userId: string;
  device: string;
  agent: string;
}

/** A prompt an agent can follow to register this server as an MCP server and check the connection. */
export function buildAgentSetupPrompt(values: AgentSetupValues): string {
  const url = values.url.trim();
  const key = values.apiKey.trim() || KEY_PLACEHOLDER;
  const headers: Record<string, string> = { "X-API-Key": key };
  if (values.userId.trim()) headers["X-Norn-M-User-Id"] = values.userId.trim();
  if (values.device.trim()) headers["X-Norn-M-Device"] = values.device.trim();
  headers["X-Norn-M-Agent"] = values.agent.trim() || AGENT_PLACEHOLDER;

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
  const listTools = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
  });

  return `Connect yourself to my self-hosted Norn-M memory server over MCP, then check that it works.

## Server
- MCP endpoint (streamable HTTP): ${url}
- Send these headers on every request:
${headerLines}
${headers["X-Norn-M-Agent"] === AGENT_PLACEHOLDER ? "  (Replace the X-Norn-M-Agent placeholder with your own name.)\n" : ""}
## Steps
1. Check that the server is reachable and the key works. The reply should be JSON listing tools such as search_memories and exact_set:
   curl -s -X POST ${url} -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -H "X-API-Key: ${key}" -d '${listTools}'
   If it fails, stop and tell me: a connection error means the URL is wrong or the server is down, and 401 means the key is wrong.
2. Register the server as "norn-m" in your own MCP configuration, at user (global) scope so it works in every project. Use the method for the agent you are:
   - Claude Code: run
     claude mcp add --transport http --scope user norn-m ${url} ${claudeHeaders}
     If "norn-m" already exists, run claude mcp remove norn-m --scope user first.
   - Devin CLI: add this entry under "mcpServers" in ~/.config/devin/mcp_config.json, then run devin mcp get norn-m:
${indent(devinEntry, 6)}
   - omp (oh-my-pi): add this entry under "mcpServers" in ~/.omp/agent/mcp.json. Keep "type": "http", or omp treats it as a local command:
${indent(ompEntry, 6)}
   - Any other agent: add a remote MCP server named "norn-m" that uses streamable HTTP with the URL and headers above, wherever your agent keeps its MCP configuration. If you are not sure where that is, ask me instead of guessing.
   When you edit a JSON config file, keep every server already in it and keep the file valid JSON. Create the file if it does not exist.
3. Confirm the server is registered with your own tooling (for example claude mcp list), and tell me whether I need to restart you to load the new tools.
4. Once the norn-m tools are loaded, call search_memories with the query "setup check" to confirm they work. Do not store anything during setup.

## Using the memory afterwards
- Call search_memories before answering anything that depends on my preferences, history, projects or earlier decisions.
- Save durable facts, preferences and decisions with add_memory. Pass project (the project or repository name, such as the git repository's folder name) and cwd (your current working directory) when the memory belongs to the work at hand.
- Anything that must come back exactly (passwords, API keys, server IPs, URLs, accounts, dates) goes in exact_set and exact_get, never add_memory.
- Never repeat the API key back to me.`;
}

function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => pad + line)
    .join("\n");
}

interface AgentSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Prefilled when opened right after creating a key. */
  initialKey?: string;
  initialUserId?: string;
}

export function AgentSetupDialog({
  open,
  onOpenChange,
  initialKey = "",
  initialUserId = "",
}: AgentSetupDialogProps) {
  const { t } = useI18n();
  const [values, setValues] = useState<AgentSetupValues>({
    url: "",
    apiKey: "",
    userId: "",
    device: "",
    agent: "",
  });
  const [copied, setCopied] = useState(false);

  const { data: entities = [] } = useApiQuery<Entity[]>(
    async () => {
      const res = await api.get<Entity[]>(ENTITY_ENDPOINTS.BASE);
      return res.data ?? [];
    },
    { initialData: [], enabled: open },
  );
  const users = useMemo(
    () => entities.filter((e) => e.type === "user").map((e) => e.id),
    [entities],
  );

  // Reset each time the dialog opens, so a key from an earlier opening never lingers.
  useEffect(() => {
    if (!open) return;
    setValues({
      url: defaultMcpUrl(),
      apiKey: initialKey,
      userId: initialUserId,
      device: guessDevice(),
      agent: "",
    });
    setCopied(false);
  }, [open, initialKey, initialUserId]);

  useEffect(() => {
    if (open && !values.userId && users.length === 1) {
      setValues((v) => ({ ...v, userId: users[0] }));
    }
  }, [open, users, values.userId]);

  const prompt = buildAgentSetupPrompt(values);
  const set =
    (field: keyof AgentSetupValues) =>
    (event: React.ChangeEvent<HTMLInputElement>) =>
      setValues((v) => ({ ...v, [field]: event.target.value }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t.agentSetup.title}</DialogTitle>
          <DialogDescription>{t.agentSetup.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="agent-setup-url">{t.agentSetup.serverUrl}</Label>
              <Input
                id="agent-setup-url"
                value={values.url}
                onChange={set("url")}
                className="font-mono text-sm"
                autoComplete="off"
              />
              <p className="text-xs text-onSurface-default-tertiary">
                {t.agentSetup.serverUrlHint}
              </p>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="agent-setup-key">{t.agentSetup.apiKey}</Label>
              <Input
                id="agent-setup-key"
                type="password"
                value={values.apiKey}
                onChange={set("apiKey")}
                placeholder={t.agentSetup.apiKeyPlaceholder}
                className="font-mono text-sm"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="agent-setup-user">{t.agentSetup.userId}</Label>
              <Input
                id="agent-setup-user"
                value={values.userId}
                onChange={set("userId")}
                list="agent-setup-users"
                autoComplete="off"
              />
              <datalist id="agent-setup-users">
                {users.map((user) => (
                  <option key={user} value={user} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1">
              <Label htmlFor="agent-setup-device">{t.agentSetup.device}</Label>
              <Input
                id="agent-setup-device"
                value={values.device}
                onChange={set("device")}
                list="agent-setup-devices"
                autoComplete="off"
              />
              <datalist id="agent-setup-devices">
                {DEVICE_SUGGESTIONS.map((device) => (
                  <option key={device} value={device} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="agent-setup-agent">{t.agentSetup.agent}</Label>
              <Input
                id="agent-setup-agent"
                value={values.agent}
                onChange={set("agent")}
                placeholder={t.agentSetup.agentPlaceholder}
                list="agent-setup-agents"
                autoComplete="off"
              />
              <datalist id="agent-setup-agents">
                {AGENT_SUGGESTIONS.map((agent) => (
                  <option key={agent} value={agent} />
                ))}
              </datalist>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="agent-setup-prompt">{t.agentSetup.prompt}</Label>
            <Textarea
              id="agent-setup-prompt"
              value={prompt}
              readOnly
              rows={12}
              className="font-mono text-xs"
            />
            {!values.apiKey.trim() && (
              <p className="text-xs text-onSurface-default-tertiary">
                {t.agentSetup.missingKey}
              </p>
            )}
            {!values.userId.trim() && (
              <p className="text-xs text-onSurface-default-tertiary">
                {t.agentSetup.missingUser}
              </p>
            )}
            {values.apiKey.trim() && (
              <p className="text-xs text-onSurface-danger-primary">
                {t.agentSetup.keyWarning}
              </p>
            )}
          </div>
          <CopyToClipboard
            text={prompt}
            onCopy={() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            <Button className="w-full" disabled={!values.url.trim()}>
              {copied ? (
                <Check className="size-4 mr-1" />
              ) : (
                <Copy className="size-4 mr-1" />
              )}
              {copied ? t.agentSetup.copied : t.agentSetup.copy}
            </Button>
          </CopyToClipboard>
        </div>
      </DialogContent>
    </Dialog>
  );
}
