"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import { CopyToClipboard } from "react-copy-to-clipboard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Segmented } from "@/components/ui/segmented";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/use-toast";
import { getErrorMessage } from "@/lib/error-message";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/utils/api";
import { API_KEY_ENDPOINTS, ENTITY_ENDPOINTS } from "@/utils/api-endpoints";
import { useApiQuery } from "@/hooks/use-api-query";
import { ApiKey, ApiKeySecret, Entity } from "@/types/api";
import { useI18n } from "@/i18n/provider";
import {
  AgentSetupValues,
  buildAgentSetupPrompt,
  buildAgentUpdatePrompt,
} from "@/lib/agent-setup-prompt";

type Mode = "setup" | "update";
// Key picker choices besides a key's id.
const PASTE = "__paste__";
const KEEP = "__keep__";
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

interface AgentSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The key to start with, e.g. one just created or picked from the list. */
  initialKeyId?: string;
}

export function AgentSetupDialog({
  open,
  onOpenChange,
  initialKeyId = "",
}: AgentSetupDialogProps) {
  const { t } = useI18n();
  const [values, setValues] = useState<AgentSetupValues>({
    url: "",
    apiKey: "",
    userId: "",
    device: "",
    agent: "",
  });
  const [mode, setMode] = useState<Mode>("setup");
  const [copied, setCopied] = useState(false);
  const [keyChoice, setKeyChoice] = useState("");
  const [loadingKey, setLoadingKey] = useState(false);
  // Only the latest pick may fill in the key, however the requests finish.
  const keyRequest = useRef(0);

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

  const { data: apiKeys = [], isLoading: keysLoading } = useApiQuery<ApiKey[]>(
    async () => (await api.get<ApiKey[]>(API_KEY_ENDPOINTS.BASE)).data ?? [],
    {
      initialData: [],
      enabled: open,
    },
  );

  const chooseKey = useCallback(
    async (choice: string, known?: ApiKey) => {
      const request = ++keyRequest.current;
      setKeyChoice(choice);
      setCopied(false);
      setValues((v) => ({ ...v, apiKey: "" }));
      if (!choice || choice === PASTE || choice === KEEP) return;
      setLoadingKey(true);
      try {
        const res = await api.get<ApiKeySecret>(API_KEY_ENDPOINTS.KEY(choice));
        if (request !== keyRequest.current) return;
        // A key limited to one user can only be used for that user.
        const onlyUser =
          known?.user_ids.length === 1 ? known.user_ids[0] : undefined;
        setValues((v) => ({
          ...v,
          apiKey: res.data.key,
          userId: onlyUser ?? v.userId,
        }));
      } catch (err) {
        if (request !== keyRequest.current) return;
        setKeyChoice(PASTE);
        toast({
          title: t.agentSetup.keyLoadFailed,
          description: getErrorMessage(err),
          variant: "destructive",
        });
      } finally {
        if (request === keyRequest.current) setLoadingKey(false);
      }
    },
    [t],
  );

  // Reset each time the dialog opens, so a key from an earlier opening never lingers.
  useEffect(() => {
    if (!open) return;
    setValues({
      url: defaultMcpUrl(),
      apiKey: "",
      userId: "",
      device: guessDevice(),
      agent: "",
    });
    setMode("setup");
    setCopied(false);
    setKeyChoice("");
    if (initialKeyId) void chooseKey(initialKeyId);
  }, [open, initialKeyId, chooseKey]);

  // With exactly one key to choose from, choose it.
  const usableKeys = useMemo(
    () => apiKeys.filter((k) => k.retrievable),
    [apiKeys],
  );
  useEffect(() => {
    if (open && mode === "setup" && !keyChoice && usableKeys.length === 1) {
      void chooseKey(usableKeys[0].id, usableKeys[0]);
    }
  }, [open, mode, keyChoice, usableKeys, chooseKey]);

  // The key list arrives after a key passed in by id was fetched; apply its user limit then.
  useEffect(() => {
    const picked = apiKeys.find((k) => k.id === keyChoice);
    if (picked?.user_ids.length === 1) {
      setValues((v) => (v.userId ? v : { ...v, userId: picked.user_ids[0] }));
    }
  }, [apiKeys, keyChoice]);

  useEffect(() => {
    if (open && mode === "setup" && !values.userId && users.length === 1) {
      setValues((v) => ({ ...v, userId: users[0] }));
    }
  }, [open, mode, users, values.userId]);

  // An update changes only what is filled in, so its optional fields start blank.
  const switchMode = (next: Mode) => {
    setMode(next);
    setCopied(false);
    if (next === "update") {
      keyRequest.current++;
      setLoadingKey(false);
      setKeyChoice(KEEP);
    } else {
      setKeyChoice("");
    }
    setValues((v) =>
      next === "update"
        ? { ...v, apiKey: "", userId: "", device: "" }
        : {
            ...v,
            userId: v.userId || (users.length === 1 ? users[0] : ""),
            device: v.device || guessDevice(),
          },
    );
  };

  const updating = mode === "update";
  const prompt = updating
    ? buildAgentUpdatePrompt(values)
    : buildAgentSetupPrompt(values);
  const set =
    (field: keyof AgentSetupValues) =>
    (event: React.ChangeEvent<HTMLInputElement>) =>
      setValues((v) => ({ ...v, [field]: event.target.value }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t.agentSetup.title}</DialogTitle>
          <DialogDescription>
            {updating
              ? t.agentSetup.updateDescription
              : t.agentSetup.description}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Segmented
            label={t.agentSetup.modeLabel}
            value={mode}
            onChange={switchMode}
            options={[
              { value: "setup", label: t.agentSetup.modeSetup },
              { value: "update", label: t.agentSetup.modeUpdate },
            ]}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="agent-setup-url">{t.agentSetup.serverUrl}</Label>
              <Input
                id="agent-setup-url"
                value={values.url}
                onChange={set("url")}
                className="font-mono text-sm"
                autoComplete="off"
              />
              <p className="text-xs text-ink-3">{t.agentSetup.serverUrlHint}</p>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="agent-setup-key">{t.agentSetup.apiKey}</Label>
              <div className="relative">
                <Select
                  value={keyChoice}
                  onValueChange={(choice) =>
                    void chooseKey(
                      choice,
                      apiKeys.find((k) => k.id === choice),
                    )
                  }
                >
                  <SelectTrigger id="agent-setup-key">
                    <SelectValue
                      placeholder={
                        keysLoading ? t.common.loading : t.agentSetup.chooseKey
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {updating && (
                      <SelectItem value={KEEP}>
                        {t.agentSetup.keepCurrentKey}
                      </SelectItem>
                    )}
                    {apiKeys.map((key) => (
                      <SelectItem
                        key={key.id}
                        value={key.id}
                        disabled={!key.retrievable}
                      >
                        {key.label}
                        <span className="ml-2 font-mono text-xs text-ink-3">
                          {key.key_prefix}…
                          {!key.retrievable &&
                            ` · ${t.agentSetup.keyUnavailable}`}
                        </span>
                      </SelectItem>
                    ))}
                    <SelectItem value={PASTE}>
                      {t.agentSetup.pasteKey}
                    </SelectItem>
                  </SelectContent>
                </Select>
                {loadingKey && (
                  <Loader2
                    className="pointer-events-none absolute right-9 top-1/2 size-4 -translate-y-1/2 animate-spin text-ink-3"
                    aria-hidden
                  />
                )}
              </div>
              {keyChoice === PASTE && (
                <Input
                  id="agent-setup-key-paste"
                  type="password"
                  value={values.apiKey}
                  onChange={set("apiKey")}
                  placeholder={t.agentSetup.apiKeyPlaceholder}
                  aria-label={t.agentSetup.apiKeyPlaceholder}
                  className="font-mono text-sm"
                  autoComplete="off"
                  autoFocus
                />
              )}
              {!keysLoading && apiKeys.length === 0 && (
                <p className="text-xs text-ink-3">{t.agentSetup.noKeys}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="agent-setup-user">{t.agentSetup.userId}</Label>
              <Input
                id="agent-setup-user"
                value={values.userId}
                onChange={set("userId")}
                placeholder={updating ? t.agentSetup.keepCurrent : undefined}
                list="agent-setup-users"
                autoComplete="off"
              />
              <datalist id="agent-setup-users">
                {users.map((user) => (
                  <option key={user} value={user} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="agent-setup-device">{t.agentSetup.device}</Label>
              <Input
                id="agent-setup-device"
                value={values.device}
                onChange={set("device")}
                placeholder={updating ? t.agentSetup.keepCurrent : undefined}
                list="agent-setup-devices"
                autoComplete="off"
              />
              <datalist id="agent-setup-devices">
                {DEVICE_SUGGESTIONS.map((device) => (
                  <option key={device} value={device} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="agent-setup-agent">{t.agentSetup.agent}</Label>
              <Input
                id="agent-setup-agent"
                value={values.agent}
                onChange={set("agent")}
                placeholder={
                  updating
                    ? t.agentSetup.agentUpdatePlaceholder
                    : t.agentSetup.agentPlaceholder
                }
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
          <div className="space-y-1.5">
            <Label htmlFor="agent-setup-prompt">{t.agentSetup.prompt}</Label>
            <Textarea
              id="agent-setup-prompt"
              value={prompt}
              readOnly
              rows={12}
              className="scrollbar-thin resize-none bg-sunken font-mono text-xs leading-5"
            />
            {!updating && !values.apiKey.trim() && (
              <p className="text-xs text-ink-3">{t.agentSetup.missingKey}</p>
            )}
            {!updating && !values.userId.trim() && (
              <p className="text-xs text-ink-3">{t.agentSetup.missingUser}</p>
            )}
            {values.apiKey.trim() && (
              <p className="text-xs text-warning">{t.agentSetup.keyWarning}</p>
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
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              {copied ? t.agentSetup.copied : t.agentSetup.copy}
            </Button>
          </CopyToClipboard>
        </div>
      </DialogContent>
    </Dialog>
  );
}
