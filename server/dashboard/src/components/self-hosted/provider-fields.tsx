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
          ? "flex items-start gap-1.5 text-xs text-emerald-700 dark:text-emerald-300"
          : "flex items-start gap-1.5 text-xs text-onSurface-danger-primary"
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
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor={id("provider")} className="text-xs">
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
        <div className="space-y-1">
          <Label htmlFor={id("model")} className="text-xs">
            {t.configuration.model}
          </Label>
          <Input
            id={id("model")}
            placeholder={
              isEmbedder
                ? compatible
                  ? "bge-m3"
                  : "text-embedding-3-small"
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
        <div className="space-y-1">
          <Label htmlFor={id("base-url")} className="text-xs">
            {t.configuration.baseUrl}
          </Label>
          <Input
            id={id("base-url")}
            type="url"
            placeholder="https://api.example.com/v1"
            value={form.baseUrl}
            onChange={(e) => onChange({ baseUrl: e.target.value })}
            disabled={disabled}
          />
          <p className="text-xs text-onSurface-default-tertiary">
            {isEmbedder
              ? t.configuration.embedderBaseUrlHint
              : t.configuration.llmBaseUrlHint}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div
          className={
            compatible && isEmbedder ? "space-y-1" : "space-y-1 sm:col-span-2"
          }
        >
          <Label htmlFor={id("api-key")} className="text-xs">
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
            <p className="text-xs text-onSurface-default-tertiary">
              {keyRequired ? t.configuration.keyRequiredHint : keyHint}
            </p>
          )}
        </div>
        {compatible && isEmbedder && (
          <div className="space-y-1">
            <Label htmlFor={id("dims")} className="text-xs">
              {t.configuration.dimensions}
            </Label>
            <Input
              id={id("dims")}
              type="number"
              min={1}
              placeholder={vectorDims ? String(vectorDims) : undefined}
              value={form.dims}
              onChange={(e) => onChange({ dims: e.target.value })}
              disabled={disabled}
            />
            <p className="text-xs text-onSurface-default-tertiary">
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
