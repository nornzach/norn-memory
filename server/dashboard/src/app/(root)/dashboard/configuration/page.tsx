"use client";

import { useState } from "react";
import { Loader2, PlugZap } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  PageHeader,
  Panel,
  PanelBody,
  PanelHeader,
} from "@/components/shared/page";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/use-toast";
import { ProviderFields } from "@/components/self-hosted/provider-fields";
import { InstructionsPanel } from "@/components/self-hosted/instructions-panel";
import { getErrorMessage } from "@/lib/error-message";
import { api } from "@/utils/api";
import { MEMORY_ENDPOINTS } from "@/utils/api-endpoints";
import {
  ProviderForm,
  ProviderSection,
  buildProviderPayload,
  getEffectiveConfig,
  hasSavedKey,
  isFormComplete,
} from "@/utils/self-hosted-config";
import { useAuth } from "@/hooks/use-auth";
import { useApiQuery } from "@/hooks/use-api-query";
import { useProviderForms } from "@/hooks/use-provider-forms";
import { useI18n } from "@/i18n/provider";

type BundledProviders = {
  llm: string[];
  embedder: string[];
};

export default function ConfigurationPage() {
  const { isAdmin } = useAuth();
  const { t } = useI18n();
  const [isSaving, setIsSaving] = useState(false);

  const {
    data: config,
    isLoading: isPrefilling,
    refetch,
  } = useApiQuery(
    async () => {
      const res = await api.get(MEMORY_ENDPOINTS.CONFIGURE);
      return getEffectiveConfig(res.data);
    },
    { errorToast: t.configuration.loadFailed },
  );

  const { data: providers } = useApiQuery<BundledProviders>(
    async () => {
      const res = await api.get<BundledProviders>(
        MEMORY_ENDPOINTS.CONFIGURE_PROVIDERS,
      );
      return res.data;
    },
    { errorToast: t.configuration.providersFailed },
  );

  const {
    saved,
    forms,
    updateForm,
    switchKind,
    testResult,
    setTestResult,
    isTesting,
    runTest,
  } = useProviderForms(config);
  const vectorDims = config?.vector_store?.config?.embedding_model_dims ?? null;

  const canSubmit =
    isFormComplete(saved.llm, forms.llm) &&
    isFormComplete(saved.embedder, forms.embedder);

  const handleTest = async () => {
    try {
      await runTest(buildProviderPayload(forms));
    } catch (error) {
      toast({
        title: t.configuration.testFailed,
        description: getErrorMessage(error),
        variant: "destructive",
      });
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await api.post(MEMORY_ENDPOINTS.CONFIGURE, buildProviderPayload(forms));
      toast({ title: t.configuration.saved, variant: "success" });
      setTestResult(null);
      await refetch();
    } catch (error) {
      toast({
        title: t.configuration.saveFailed,
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const sectionProps = (section: ProviderSection) => ({
    idPrefix: "config",
    section,
    form: forms[section],
    saved: saved[section],
    savedKey: hasSavedKey(config?.[section]),
    providers: providers?.[section],
    disabled: !isAdmin,
    vectorDims,
    result: testResult?.[section],
    onKindChange: (kind: string) => switchKind(section, kind),
    onChange: (patch: Partial<ProviderForm>) => updateForm(section, patch),
  });

  const actions = isAdmin && (
    <>
      <Button
        variant="outline"
        onClick={handleTest}
        disabled={!canSubmit || isTesting || isSaving}
      >
        {isTesting ? (
          <Loader2 className="animate-spin" aria-hidden />
        ) : (
          <PlugZap aria-hidden />
        )}
        {isTesting ? t.configuration.testing : t.configuration.testConnection}
      </Button>
      <Button
        onClick={handleSave}
        disabled={!canSubmit || isSaving || isTesting}
      >
        {isSaving && <Loader2 className="animate-spin" aria-hidden />}
        {isSaving ? t.common.saving : t.configuration.save}
      </Button>
    </>
  );

  return (
    <>
      <PageHeader
        title={t.configuration.title}
        description={t.configuration.subtitle}
        actions={actions}
      />

      {!isAdmin && (
        <p className="mb-4 rounded-lg bg-info-soft px-4 py-3 text-sm text-info">
          {t.configuration.readOnly}
        </p>
      )}

      <div
        className={cn(
          "grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-2",
          isPrefilling && "opacity-60",
        )}
        aria-busy={isPrefilling}
      >
        {(["llm", "embedder"] as const).map((section) => (
          <Panel key={section}>
            <PanelHeader
              title={
                section === "llm"
                  ? t.configuration.llmProvider
                  : t.configuration.embeddingModel
              }
              description={
                section === "llm"
                  ? t.configuration.llmDescription
                  : t.configuration.embedderDescription
              }
            />
            <PanelBody>
              <ProviderFields {...sectionProps(section)} />
            </PanelBody>
          </Panel>
        ))}
      </div>

      <InstructionsPanel
        saved={config ? (config.custom_instructions ?? "") : undefined}
        disabled={!isAdmin}
        onSaved={refetch}
      />

      <div className="mt-4 space-y-2 text-xs text-ink-3">
        {isAdmin && !canSubmit && config && (
          <p className="text-warning">{t.configuration.requiredFields}</p>
        )}
        <p>
          {t.configuration.otherProviderBefore}
          <a
            href="https://github.com/nornzach/norn-memory/blob/main/docs/configuration.md#providers"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-brand-text underline-offset-4 hover:underline"
          >
            {t.configuration.setupGuide}
          </a>
          {t.configuration.otherProviderAfter}
        </p>
      </div>
    </>
  );
}
