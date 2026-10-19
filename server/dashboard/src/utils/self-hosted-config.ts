type ProviderConfig = {
  provider?: string;
  config?: {
    model?: string;
    api_key?: string;
    openai_base_url?: string | null;
    embedding_dims?: number | null;
  };
};

export type EffectiveConfig = {
  llm?: ProviderConfig;
  embedder?: ProviderConfig;
  vector_store?: { config?: { embedding_model_dims?: number } };
};

export const getEffectiveConfig = (data: unknown): EffectiveConfig | null => {
  if (!data || typeof data !== "object") {
    return null;
  }

  const record = data as Record<string, unknown>;
  return (
    (record.effective_config as EffectiveConfig) ||
    (record.config as EffectiveConfig) ||
    (record as EffectiveConfig)
  );
};

/**
 * "OpenAI-compatible" is not a server provider: it is the `openai` provider pointed at another
 * URL through `openai_base_url`, which the SDK supports for both the LLM and the embedder.
 */
export const OPENAI_COMPATIBLE = "openai_compatible";

export type ProviderSection = "llm" | "embedder";

export const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
  deepseek: "DeepSeek",
};

export type ProviderForm = {
  /** A bundled provider name, or OPENAI_COMPATIBLE. */
  kind: string;
  model: string;
  /** Typed by the user; empty means "keep the saved key". */
  apiKey: string;
  baseUrl: string;
  /** Embedder only; empty means "don't send a dimensions parameter". */
  dims: string;
};

export const EMPTY_FORM: ProviderForm = {
  kind: "",
  model: "",
  apiKey: "",
  baseUrl: "",
  dims: "",
};

export const formFromConfig = (section?: ProviderConfig): ProviderForm => {
  const config = section?.config ?? {};
  const baseUrl = config.openai_base_url ?? "";
  return {
    kind:
      section?.provider === "openai" && baseUrl
        ? OPENAI_COMPATIBLE
        : (section?.provider ?? ""),
    model: config.model ?? "",
    apiKey: "",
    baseUrl,
    dims: config.embedding_dims ? String(config.embedding_dims) : "",
  };
};

export const hasSavedKey = (section?: ProviderConfig) =>
  Boolean(section?.config?.api_key);

/** The server drops the saved key when the provider or base URL changes. */
export const endpointChanged = (saved: ProviderForm, form: ProviderForm) =>
  !sameEndpoint(saved, form);

/** The fields a form must have before it can be saved or tested. */
export const isFormComplete = (saved: ProviderForm, form: ProviderForm) => {
  if (!form.kind) return false;
  if (form.kind !== OPENAI_COMPATIBLE) return true;
  const needsKey = endpointChanged(saved, form);
  return Boolean(
    form.baseUrl.trim() &&
    form.model.trim() &&
    (!needsKey || form.apiKey.trim()),
  );
};

export const buildSectionConfig = (
  form: ProviderForm,
  { embedder }: { embedder: boolean },
) => {
  if (!form.kind) return undefined;
  const config: Record<string, unknown> = {};
  if (form.model.trim()) config.model = form.model.trim();
  if (form.apiKey.trim()) config.api_key = form.apiKey.trim();

  if (form.kind === OPENAI_COMPATIBLE) {
    config.openai_base_url = form.baseUrl.trim();
    if (embedder) {
      // null tells the SDK not to send `dimensions`, which many compatible servers reject.
      config.embedding_dims = form.dims.trim() ? Number(form.dims) : null;
    }
    return { provider: "openai", config };
  }
  if (form.kind === "openai") {
    // Clear a base URL left from an earlier OpenAI-compatible setup.
    config.openai_base_url = null;
  }
  return { provider: form.kind, config };
};

/** The llm/embedder part of a POST /configure (or /configure/test) body. */
export const buildProviderPayload = (
  forms: Record<ProviderSection, ProviderForm>,
) => {
  const payload: Record<string, unknown> = { version: "v1.1" };
  const llm = buildSectionConfig(forms.llm, { embedder: false });
  const embedder = buildSectionConfig(forms.embedder, { embedder: true });
  if (llm) payload.llm = llm;
  if (embedder) payload.embedder = embedder;
  return payload;
};

/** True when the form differs from what the server has, or a key was typed. */
export const isFormDirty = (saved: ProviderForm, form: ProviderForm) =>
  Boolean(form.apiKey.trim()) ||
  saved.kind !== form.kind ||
  saved.model.trim() !== form.model.trim() ||
  saved.baseUrl.trim() !== form.baseUrl.trim() ||
  saved.dims.trim() !== form.dims.trim();

/** Same provider and, for OpenAI-compatible, the same base URL. */
export const sameEndpoint = (a: ProviderForm, b: ProviderForm) =>
  a.kind === b.kind &&
  (a.kind !== OPENAI_COMPATIBLE || a.baseUrl.trim() === b.baseUrl.trim());

/** Reuse a typed LLM key for an embedder on the same endpoint that has none of its own. */
export const shareLlmKey = (llm: ProviderForm, embedder: ProviderForm) =>
  !embedder.apiKey.trim() && llm.apiKey.trim() && sameEndpoint(llm, embedder)
    ? { ...embedder, apiKey: llm.apiKey }
    : embedder;
