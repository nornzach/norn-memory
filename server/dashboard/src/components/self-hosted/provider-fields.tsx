"use client";

import { CheckCircle2, XCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  OPENAI_COMPATIBLE,
  EMBEDDER_MODEL_PLACEHOLDERS,
  PROVIDER_LABELS,
  ProviderForm,
  ProviderSection,
  endpointChanged,
} from "@/utils/self-hosted-config";
import { useI18n } from "@/i18n/provider";

/** One half of a POST /configure/test response. */
export type CheckResult = {
  ok: boolean;
  error: string | null;
  latency_ms: number | null;
  dims?: number | null;
  expected_dims?: number | null;
};

export function CheckLine({
  label,
  result,
}: {
  label: string;
  result: CheckResult;
}) {
  const { t } = useI18n();
  const details = result.ok
    ? [
        result.latency_ms !== null &&
          t.configuration.connected(result.latency_ms),
        result.dims && t.configuration.vectorSize(result.dims),
      ]
        .filter(Boolean)
        .join(" · ")
    : result.dims &&
        result.expected_dims &&
        result.dims !== result.expected_dims
      ? t.configuration.dimsMismatch(result.dims, result.expected_dims)
      : result.error;
  return (
    <p
      className={
        result.ok
          ? "flex items-start gap-1.5 text-xs text-success"
          : "flex items-start gap-1.5 text-xs text-danger"
      }
    >
      {result.ok ? (
        <CheckCircle2 className="size-3.5 shrink-0 mt-px" />
      ) : (
        <XCircle className="size-3.5 shrink-0 mt-px" />
      )}
      <span className="min-w-0 break-words">
        <span className="font-medium">{label}:</span> {details}
      </span>
    </p>
  );
}

/**
 * Provider, model, API key and, for an OpenAI-compatible endpoint, base URL (plus
 * dimensions for the embedder). Shared by the Configuration page and the setup wizard.
 */
export function ProviderFields({
  idPrefix,
  section,
  form,
  saved,
  savedKey,
  providers,
  disabled = false,
  vectorDims,
  result,
  providerLabel,
  keyLabel,
  keyPlaceholder,
  keyHint,
  onKindChange,
  onChange,
}: {
  idPrefix: string;
  section: ProviderSection;
  form: ProviderForm;
  saved: ProviderForm;
  savedKey: boolean;
  providers: string[] | undefined;
  disabled?: boolean;
  vectorDims: number | null;
  result: CheckResult | undefined;
  providerLabel?: string;
  keyLabel?: string;
  /** Overrides the default "saved / required / environment" placeholder. */
  keyPlaceholder?: string;
  keyHint?: string;
  onKindChange: (kind: string) => void;
  onChange: (patch: Partial<ProviderForm>) => void;
}) {
  const { t } = useI18n();
  const isEmbedder = section === "embedder";
  const compatible = form.kind === OPENAI_COMPATIBLE;
  const changed = endpointChanged(saved, form);
  const keyRequired = compatible && changed && !keyPlaceholder;
  const placeholder =
    keyPlaceholder ??
    (keyRequired
      ? t.configuration.keyRequired
      : savedKey && !changed
        ? t.configuration.keepSavedKey
        : t.configuration.envKey);
  const options = providers
    ? [
        ...providers,
        ...(providers.includes("openai") ? [OPENAI_COMPATIBLE] : []),
      ]
    : [];
  const id = (field: string) => `${idPrefix}-${section}-${field}`;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={id("provider")}>
            {providerLabel ?? t.configuration.provider}
          </Label>
          <Select
            value={form.kind}
            onValueChange={onKindChange}
            disabled={disabled || !providers}
          >
            <SelectTrigger id={id("provider")}>
              <SelectValue placeholder={t.configuration.selectProvider} />
            </SelectTrigger>
            <SelectContent>
              {options.map((name) => (
                <SelectItem key={name} value={name}>
                  {name === OPENAI_COMPATIBLE
                    ? t.configuration.openaiCompatible
                    : (PROVIDER_LABELS[name] ?? name)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={id("model")}>{t.configuration.model}</Label>
          <Input
            id={id("model")}
            placeholder={
              isEmbedder
                ? compatible
                  ? "bge-m3"
                  : (EMBEDDER_MODEL_PLACEHOLDERS[form.kind] ??
                    "text-embedding-3-small")
                : compatible
                  ? "qwen2.5-72b-instruct"
                  : "gpt-4.1-nano-2025-04-14"
            }
            value={form.model}
            onChange={(e) => onChange({ model: e.target.value })}
            disabled={disabled}
          />
        </div>
      </div>

      {compatible && (
        <div className="space-y-1.5">
          <Label htmlFor={id("base-url")}>{t.configuration.baseUrl}</Label>
          <Input
            id={id("base-url")}
            type="url"
            placeholder="https://api.example.com/v1"
            value={form.baseUrl}
            onChange={(e) => onChange({ baseUrl: e.target.value })}
            disabled={disabled}
          />
          <p className="text-xs text-ink-3">
            {isEmbedder
              ? t.configuration.embedderBaseUrlHint
              : t.configuration.llmBaseUrlHint}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div
          className={
            compatible && isEmbedder
              ? "space-y-1.5"
              : "space-y-1.5 sm:col-span-2"
          }
        >
          <Label htmlFor={id("api-key")}>
            {keyLabel ?? t.configuration.apiKey}
          </Label>
          <Input
            id={id("api-key")}
            type="password"
            autoComplete="off"
            placeholder={placeholder}
            value={form.apiKey}
            onChange={(e) => onChange({ apiKey: e.target.value })}
            disabled={disabled}
          />
          {(keyRequired || keyHint) && (
            <p className="text-xs text-ink-3">
              {keyRequired ? t.configuration.keyRequiredHint : keyHint}
            </p>
          )}
        </div>
        {compatible && isEmbedder && (
          <div className="space-y-1.5">
            <Label htmlFor={id("dims")}>{t.configuration.dimensions}</Label>
            <Input
              id={id("dims")}
              type="number"
              min={1}
              placeholder={vectorDims ? String(vectorDims) : undefined}
              value={form.dims}
              onChange={(e) => onChange({ dims: e.target.value })}
              disabled={disabled}
            />
            <p className="text-xs text-ink-3">
              {t.configuration.dimensionsHint(vectorDims)}
            </p>
          </div>
        )}
      </div>

      {result && (
        <CheckLine
          label={isEmbedder ? t.configuration.embedder : t.configuration.llm}
          result={result}
        />
      )}
    </div>
  );
}
