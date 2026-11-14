"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelHeader } from "@/components/shared/page";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/use-toast";
import { CheckLine, type CheckResult } from "./provider-fields";
import { useI18n } from "@/i18n/provider";
import { getErrorMessage } from "@/lib/error-message";
import { api } from "@/utils/api";
import { MEMORY_ENDPOINTS } from "@/utils/api-endpoints";
import type { EffectiveConfig } from "@/utils/self-hosted-config";

const DEFAULT_URL = "https://maas.qianwenaiapi.com/compatible-api/v1";

export function RerankerFields({
  config,
  disabled,
  onSaved,
}: {
  config: EffectiveConfig | null | undefined;
  disabled: boolean;
  onSaved: () => Promise<unknown>;
}) {
  const { t } = useI18n();
  const text = t.configuration.reranker;
  const [enabled, setEnabled] = useState(false);
  const [form, setForm] = useState({
    model: "qwen3.7-text-rerank",
    baseUrl: DEFAULT_URL,
    apiKey: "",
    pool: "60",
    timeout: "5",
    minScore: "",
  });
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [result, setResult] = useState<CheckResult | null>(null);

  useEffect(() => {
    if (!config) return;
    const saved = config.reranker;
    setEnabled(Boolean(saved && saved.enabled !== false));
    setForm({
      model: saved?.config?.model ?? "qwen3.7-text-rerank",
      baseUrl: saved?.config?.base_url ?? DEFAULT_URL,
      apiKey: "",
      pool: String(saved?.candidate_pool_size ?? 60),
      timeout: String(saved?.config?.timeout ?? 5),
      minScore:
        saved?.config?.min_score == null ? "" : String(saved.config.min_score),
    });
    setResult(null);
  }, [config]);

  const update = (key: keyof typeof form, value: string) => {
    setForm((previous) => ({ ...previous, [key]: value }));
    setResult(null);
  };
  const sameEndpoint =
    form.baseUrl.trim().replace(/\/$/, "") ===
    (config?.reranker?.config?.base_url ?? DEFAULT_URL).replace(/\/$/, "");
  const valid =
    form.model.trim() &&
    /^https?:\/\//.test(form.baseUrl.trim()) &&
    Number.isInteger(Number(form.pool)) &&
    Number(form.pool) >= 1 &&
    Number(form.pool) <= 500 &&
    Number(form.timeout) > 0 &&
    Number(form.timeout) <= 30 &&
    (!form.minScore ||
      (Number(form.minScore) >= 0 && Number(form.minScore) <= 1)) &&
    (sameEndpoint || form.apiKey.trim() || !enabled);

  const submit = async (action: "save" | "test") => {
    setBusy(action);
    setResult(null);
    const payload = {
      reranker: {
        provider: "qwen",
        enabled: action === "test" || enabled,
        candidate_pool_size: Number(form.pool),
        config: {
          model: form.model.trim(),
          base_url: form.baseUrl.trim(),
          ...(form.apiKey.trim() ? { api_key: form.apiKey.trim() } : {}),
          timeout: Number(form.timeout),
          min_score: form.minScore ? Number(form.minScore) : null,
        },
      },
    };
    try {
      if (action === "test") {
        const response = await api.post<{ reranker: CheckResult }>(
          MEMORY_ENDPOINTS.CONFIGURE_TEST,
          payload,
        );
        setResult(response.data.reranker);
      } else {
        await api.post(MEMORY_ENDPOINTS.CONFIGURE, payload);
        toast({ title: t.configuration.saved, variant: "success" });
        await onSaved();
      }
    } catch (error) {
      toast({
        title:
          action === "test"
            ? t.configuration.testFailed
            : t.configuration.saveFailed,
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const fields = [
    ["model", t.configuration.model, "text"],
    ["baseUrl", t.configuration.baseUrl, "url"],
    ["apiKey", t.configuration.apiKey, "password"],
    ["pool", text.pool, "number"],
    ["timeout", text.timeout, "number"],
    ["minScore", text.minScore, "number"],
  ] as const;

  return (
    <Panel className="mt-4">
      <PanelHeader title={text.title} />
      <PanelBody className="space-y-4">
        <p className="text-xs text-ink-3">{text.description}</p>
        <div className="flex items-center gap-3">
          <Switch
            id="reranker-enabled"
            checked={enabled}
            disabled={disabled || !!busy || !config}
            onCheckedChange={(value) => {
              setEnabled(value);
              setResult(null);
            }}
          />
          <Label htmlFor="reranker-enabled">{text.enabled}</Label>
        </div>
        <fieldset
          disabled={disabled || !!busy || !config}
          className="grid gap-4 md:grid-cols-2"
        >
          {fields.map(([key, label, type]) => (
            <div key={key} className="space-y-2">
              <Label htmlFor={`reranker-${key}`}>{label}</Label>
              <Input
                id={`reranker-${key}`}
                type={type}
                value={form[key]}
                autoComplete={key === "apiKey" ? "new-password" : undefined}
                min={
                  key === "pool"
                    ? 1
                    : key === "timeout"
                      ? 0.1
                      : key === "minScore"
                        ? 0
                        : undefined
                }
                max={
                  key === "pool"
                    ? 500
                    : key === "timeout"
                      ? 30
                      : key === "minScore"
                        ? 1
                        : undefined
                }
                step={key === "pool" ? 1 : "any"}
                placeholder={
                  key === "apiKey" &&
                  config?.reranker?.config?.api_key &&
                  sameEndpoint
                    ? t.configuration.keepSavedKey
                    : key === "minScore"
                      ? text.off
                      : undefined
                }
                onChange={(event) => update(key, event.target.value)}
              />
            </div>
          ))}
        </fieldset>
        <p className="text-xs text-ink-3">{text.thresholdHint}</p>
        {!sameEndpoint && (
          <p className="text-xs text-ink-3">
            {t.configuration.keyRequiredHint}
          </p>
        )}
        {result && <CheckLine label={text.title} result={result} />}
        {!disabled && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={!valid || !!busy || !config}
              onClick={() => submit("test")}
            >
              {busy === "test"
                ? t.configuration.testing
                : t.configuration.testConnection}
            </Button>
            <Button
              disabled={!valid || !!busy || !config}
              onClick={() => submit("save")}
            >
              {busy === "save" ? t.common.saving : text.save}
            </Button>
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}
