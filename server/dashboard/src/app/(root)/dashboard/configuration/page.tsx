"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/use-toast";
import { ProviderFields } from "@/components/self-hosted/provider-fields";
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

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold font-fustat">
          {t.configuration.title}
        </h1>
        {isPrefilling && (
          <p className="text-sm text-onSurface-default-tertiary">
            {t.configuration.loading}
          </p>
        )}
      </div>

      {(["llm", "embedder"] as const).map((section) => (
        <Card key={section} className="border-memBorder-primary">
          <CardHeader>
            <CardTitle className="text-sm">
              {section === "llm"
                ? t.configuration.llmProvider
                : t.configuration.embeddingModel}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ProviderFields {...sectionProps(section)} />
          </CardContent>
        </Card>
      ))}

      <p className="text-xs text-onSurface-default-tertiary">
        {t.configuration.otherProviderBefore}
        <a
          href="https://github.com/nornzach/norn-memory/blob/main/docs/configuration.md#providers"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-4 hover:text-onSurface-default-primary"
        >
          {t.configuration.setupGuide}
        </a>
        {t.configuration.otherProviderAfter}
      </p>

      {isAdmin && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={handleTest}
              disabled={!canSubmit || isTesting || isSaving}
            >
              {isTesting
                ? t.configuration.testing
                : t.configuration.testConnection}
            </Button>
            <Button
              onClick={handleSave}
              disabled={!canSubmit || isSaving || isTesting}
            >
              {isSaving ? t.common.saving : t.configuration.save}
            </Button>
          </div>
          {!canSubmit && config && (
            <p className="text-xs text-onSurface-default-tertiary">
              {t.configuration.requiredFields}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
