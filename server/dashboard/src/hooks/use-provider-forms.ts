import { useEffect, useMemo, useRef, useState } from "react";
import type { CheckResult } from "@/components/self-hosted/provider-fields";
import { api } from "@/utils/api";
import { MEMORY_ENDPOINTS } from "@/utils/api-endpoints";
import {
  EMPTY_FORM,
  EffectiveConfig,
  ProviderForm,
  ProviderSection,
  formFromConfig,
} from "@/utils/self-hosted-config";

export type ProviderTestResponse = Record<ProviderSection, CheckResult>;

/**
 * Form state for the LLM and embedder sections, seeded from the server config. Switching
 * provider keeps what was typed for the previous one, so switching back restores it.
 */
export function useProviderForms(config: EffectiveConfig | null | undefined) {
  const saved = useMemo(
    () => ({
      llm: formFromConfig(config?.llm),
      embedder: formFromConfig(config?.embedder),
    }),
    [config],
  );
  const [forms, setForms] = useState<Record<ProviderSection, ProviderForm>>({
    llm: EMPTY_FORM,
    embedder: EMPTY_FORM,
  });
  const drafts = useRef<Record<ProviderSection, Record<string, ProviderForm>>>({
    llm: {},
    embedder: {},
  });
  const [testResult, setTestResult] = useState<ProviderTestResponse | null>(
    null,
  );
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    if (!config) return;
    setForms(saved);
    drafts.current = { llm: {}, embedder: {} };
    setTestResult(null);
  }, [config, saved]);

  const updateForm = (
    section: ProviderSection,
    patch: Partial<ProviderForm>,
  ) => {
    setForms((current) => ({
      ...current,
      [section]: { ...current[section], ...patch },
    }));
    setTestResult(null);
  };

  const switchKind = (section: ProviderSection, kind: string) => {
    setForms((current) => {
      drafts.current[section][current[section].kind] = current[section];
      const next =
        drafts.current[section][kind] ??
        (kind === saved[section].kind
          ? saved[section]
          : { ...EMPTY_FORM, kind });
      return { ...current, [section]: next };
    });
    setTestResult(null);
  };

  /** POST /configure/test; resolves to the results, rejects on a request error. */
  const runTest = async (payload: Record<string, unknown>) => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await api.post<ProviderTestResponse>(
        MEMORY_ENDPOINTS.CONFIGURE_TEST,
        payload,
      );
      setTestResult(res.data);
      return res.data;
    } finally {
      setIsTesting(false);
    }
  };

  return {
    saved,
    forms,
    updateForm,
    switchKind,
    testResult,
    setTestResult,
    isTesting,
    runTest,
  };
}
