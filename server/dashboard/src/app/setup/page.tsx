"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy } from "lucide-react";
import { CopyToClipboard } from "react-copy-to-clipboard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { getErrorMessage } from "@/lib/error-message";
import { cn } from "@/lib/utils";
import { api } from "@/utils/api";
import {
  API_KEY_ENDPOINTS,
  AUTH_ENDPOINTS,
  MEMORY_ENDPOINTS,
} from "@/utils/api-endpoints";
import {
  EffectiveConfig,
  ProviderForm,
  ProviderSection,
  buildProviderPayload,
  getEffectiveConfig,
  hasSavedKey,
  isFormComplete,
  isFormDirty,
  sameEndpoint,
  shareLlmKey,
} from "@/utils/self-hosted-config";
import { ProviderFields } from "@/components/self-hosted/provider-fields";
import { useProviderForms } from "@/hooks/use-provider-forms";
import { isValidEmail } from "@/lib/validators";
import { LanguageSwitcher } from "@/components/misc/language-switcher";
import { useI18n } from "@/i18n/provider";

type BundledProviders = {
  llm: string[];
  embedder: string[];
};

const SUPPORTED_PROVIDERS_URL =
  "https://github.com/nornzach/norn-memory/blob/main/docs/configuration.md#providers";

export default function SetupPage() {
  const router = useRouter();
  const { register } = useAuth();
  const { t } = useI18n();
  const [step, setStep] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isPrefillingConfig, setIsPrefillingConfig] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [config, setConfig] = useState<EffectiveConfig | null>(null);
  const [providers, setProviders] = useState<BundledProviders | null>(null);
  const {
    saved,
    forms,
    updateForm,
    switchKind,
    testResult,
    isTesting,
    runTest,
  } = useProviderForms(config);

  const [apiKey, setApiKey] = useState("");
  const [keyLabel, setKeyLabel] = useState("");
  const [copied, setCopied] = useState(false);
  const [testSuccess, setTestSuccess] = useState(false);

  const [useCase, setUseCase] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [testMessage, setTestMessage] = useState(t.setup.defaultTestMessage);
  const [isGeneratingInstructions, setIsGeneratingInstructions] =
    useState(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";

  useEffect(() => {
    if (step !== 1) {
      setIsPrefillingConfig(false);
      return;
    }

    let active = true;
    setIsPrefillingConfig(true);

    const loadConfig = async () => {
      try {
        const [configRes, providersRes] = await Promise.all([
          api.get(MEMORY_ENDPOINTS.CONFIGURE),
          api.get<BundledProviders>(MEMORY_ENDPOINTS.CONFIGURE_PROVIDERS),
        ]);
        if (!active) {
          return;
        }

        setConfig(getEffectiveConfig(configRes.data));
        setProviders(providersRes.data);
      } catch (err) {
        if (active) {
          setError(getErrorMessage(err, t.setup.errors.readConfig));
        }
      } finally {
        if (active) {
          setIsPrefillingConfig(false);
        }
      }
    };

    void loadConfig();

    return () => {
      active = false;
    };
  }, [step]);

  const handleStep1 = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isValidEmail(email)) {
      setError(t.setup.errors.invalidEmail);
      return;
    }

    if (password !== confirmPassword) {
      setError(t.setup.errors.passwordMismatch);
      return;
    }

    if (password.length < 8) {
      setError(t.setup.errors.passwordTooShort);
      return;
    }

    setError("");
    setIsLoading(true);

    try {
      await register(name, email, password);
      setStep(1);
    } catch (err) {
      setError(getErrorMessage(err, t.setup.errors.registration));
    } finally {
      setIsLoading(false);
    }
  };

  const serverHasLlmKey = hasSavedKey(config?.llm);
  // An embedder on the same endpoint as the LLM reuses the LLM key typed above.
  const providerForms = {
    llm: forms.llm,
    embedder: shareLlmKey(forms.llm, forms.embedder),
  };
  const providersReady =
    isFormComplete(saved.llm, providerForms.llm) &&
    isFormComplete(saved.embedder, providerForms.embedder) &&
    (serverHasLlmKey || !!forms.llm.apiKey.trim());
  const vectorDims = config?.vector_store?.config?.embedding_model_dims ?? null;

  const handleTestProviders = async () => {
    setError("");
    try {
      await runTest(buildProviderPayload(providerForms));
    } catch (err) {
      setError(getErrorMessage(err, t.configuration.testFailed));
    }
  };

  const handleStep2 = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const dirty =
      isFormDirty(saved.llm, forms.llm) ||
      isFormDirty(saved.embedder, forms.embedder);

    if (!dirty) {
      setStep(2);
      return;
    }

    setIsLoading(true);
    try {
      await api.post(
        MEMORY_ENDPOINTS.CONFIGURE,
        buildProviderPayload(providerForms),
      );
      setStep(2);
    } catch (err) {
      setError(getErrorMessage(err, t.setup.errors.saveConfig));
    } finally {
      setIsLoading(false);
    }
  };

  const providerFieldProps = (section: ProviderSection) => ({
    idPrefix: "setup",
    section,
    form: forms[section],
    saved: saved[section],
    savedKey: hasSavedKey(config?.[section]),
    providers: providers?.[section],
    vectorDims,
    result: testResult?.[section],
    onKindChange: (kind: string) => switchKind(section, kind),
    onChange: (patch: Partial<ProviderForm>) => updateForm(section, patch),
  });

  const handleStep3 = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const res = await api.post(API_KEY_ENDPOINTS.BASE, {
        label: keyLabel.trim() || t.setup.defaultKeyLabel,
      });
      setApiKey(res.data.key);
    } catch (err) {
      setError(getErrorMessage(err, t.setup.errors.createKey));
    } finally {
      setIsLoading(false);
    }
  };

  const handleContinueToUseCase = (e: React.FormEvent) => {
    e.preventDefault();
    setStep(3);
  };

  const handleContinueToQuickTest = () => {
    setError("");
    setStep(4);
  };

  const handleGoToDashboard = (e: React.FormEvent) => {
    e.preventDefault();
    router.push("/dashboard/requests");
  };

  const handleTest = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const res = await fetch(`${apiUrl}/memories`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
        body: JSON.stringify({
          messages: [{ role: "user", content: testMessage }],
          user_id: "setup-test",
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        let detail = body;
        try {
          detail = JSON.parse(body).detail ?? body;
        } catch {}
        throw new Error(
          t.setup.errors.testStatus(res.status, detail || res.statusText),
        );
      }

      setTestSuccess(true);
    } catch (err) {
      setError(getErrorMessage(err, t.setup.errors.test));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-surface-default-primary p-4">
      <LanguageSwitcher className="absolute right-4 top-4" />
      <div className="w-full max-w-[560px] space-y-6">
        <div className="flex items-center justify-center gap-2">
          {t.setup.steps.map((label, i) => (
            <div key={i} className="flex items-center gap-2">
              <div
                className={cn(
                  "size-7 rounded-full flex items-center justify-center text-xs font-medium",
                  i <= step
                    ? "bg-memPurple-500 text-white"
                    : "bg-memNeutral-200 text-onSurface-default-tertiary",
                )}
              >
                {i < step ? <Check className="size-3.5" /> : i + 1}
              </div>
              {i < t.setup.steps.length - 1 && (
                <div
                  className={cn(
                    "w-8 h-[2px]",
                    i < step ? "bg-memPurple-500" : "bg-memNeutral-200",
                  )}
                />
              )}
            </div>
          ))}
        </div>
        <p className="text-center text-sm text-onSurface-default-tertiary">
          {t.setup.steps[step]}
        </p>

        <Card className="border-memBorder-primary">
          <CardContent className="p-6 space-y-4">
            <div className="space-y-1">
              <h2 className="text-base font-semibold font-fustat">
                {t.setup.stepTitles[step]}
              </h2>
              {isPrefillingConfig && step === 1 && (
                <p className="text-xs text-onSurface-default-tertiary">
                  {t.setup.checkingConfig}
                </p>
              )}
            </div>
            {error && (
              <p className="text-sm text-onSurface-danger-primary">{error}</p>
            )}

            {step === 0 && (
              <form onSubmit={handleStep1} className="space-y-4">
                <div className="space-y-1">
                  <Label htmlFor="setup-name">{t.common.name}</Label>
                  <Input
                    id="setup-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t.setup.namePlaceholder}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="setup-email">{t.common.email}</Label>
                  <Input
                    id="setup-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin@company.com"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="setup-password">{t.common.password}</Label>
                  <Input
                    id="setup-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t.setup.passwordPlaceholder}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="setup-confirm-password">
                    {t.setup.confirmPassword}
                  </Label>
                  <Input
                    id="setup-confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </div>
                <Button
                  type="submit"
                  disabled={isLoading || !name || !email || !password}
                  className="w-full"
                >
                  {isLoading ? t.setup.creating : t.setup.createAdmin}
                </Button>
              </form>
            )}

            {step === 1 && (
              <form onSubmit={handleStep2} className="space-y-4">
                {!serverHasLlmKey && (
                  <div className="rounded-md border border-memBorder-primary bg-surface-default-secondary p-3">
                    <p className="text-xs text-onSurface-default-tertiary">
                      {t.setup.noLlmKey}
                    </p>
                  </div>
                )}

                <ProviderFields
                  {...providerFieldProps("llm")}
                  providerLabel={t.setup.llmProvider}
                  keyLabel={t.setup.llmApiKey}
                  keyPlaceholder={
                    serverHasLlmKey && sameEndpoint(saved.llm, forms.llm)
                      ? t.setup.keepExistingKey
                      : undefined
                  }
                  keyHint={t.setup.sharedKeyHint}
                />

                <div className="border-t border-memBorder-primary pt-4">
                  <ProviderFields
                    {...providerFieldProps("embedder")}
                    providerLabel={t.setup.embedderProvider}
                    keyPlaceholder={
                      forms.llm.apiKey.trim() &&
                      sameEndpoint(forms.llm, forms.embedder)
                        ? t.setup.reuseLlmKey
                        : undefined
                    }
                  />
                </div>

                <p className="text-xs text-onSurface-default-tertiary">
                  {t.setup.otherProviderBefore}
                  <a
                    href={SUPPORTED_PROVIDERS_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-4 hover:text-onSurface-default-primary"
                  >
                    {t.setup.supportedProviders}
                  </a>
                  {t.setup.otherProviderAfter}
                </p>

                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleTestProviders}
                    disabled={isLoading || isTesting || !providersReady}
                  >
                    {isTesting
                      ? t.configuration.testing
                      : t.configuration.testConnection}
                  </Button>
                  <Button
                    type="submit"
                    disabled={isLoading || isTesting || !providersReady}
                    className="flex-1"
                  >
                    {isLoading ? t.common.saving : t.setup.saveAndContinue}
                  </Button>
                </div>
              </form>
            )}

            {step === 2 && !apiKey && (
              <form onSubmit={handleStep3} className="space-y-4">
                <div className="space-y-1">
                  <Label htmlFor="setup-key-label">{t.setup.keyLabel}</Label>
                  <Input
                    id="setup-key-label"
                    value={keyLabel}
                    onChange={(e) => setKeyLabel(e.target.value)}
                    placeholder={t.setup.defaultKeyLabel}
                  />
                </div>
                <Button type="submit" disabled={isLoading} className="w-full">
                  {isLoading ? t.setup.generating : t.setup.generateKey}
                </Button>
              </form>
            )}

            {step === 2 && apiKey && (
              <form onSubmit={handleContinueToUseCase} className="space-y-4">
                <div className="space-y-1">
                  <Label htmlFor="setup-api-key">{t.setup.yourKey}</Label>
                  <div className="flex gap-2">
                    <Input
                      id="setup-api-key"
                      value={apiKey}
                      readOnly
                      className="font-mono text-sm"
                    />
                    <CopyToClipboard
                      text={apiKey}
                      onCopy={() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                    >
                      <Button variant="outline" size="icon">
                        {copied ? (
                          <Check className="size-4" />
                        ) : (
                          <Copy className="size-4" />
                        )}
                      </Button>
                    </CopyToClipboard>
                  </div>
                  <p className="text-xs text-onSurface-danger-primary">
                    {t.setup.saveKeyWarning}
                  </p>
                </div>
                <Button type="submit" className="w-full">
                  {t.common.continue}
                </Button>
              </form>
            )}

            {step === 3 && (
              <div className="space-y-4">
                <div className="space-y-1">
                  <Label htmlFor="setup-use-case">
                    {t.setup.describeUseCase}
                  </Label>
                  <textarea
                    id="setup-use-case"
                    value={useCase}
                    onChange={(e) => setUseCase(e.target.value)}
                    placeholder={t.setup.useCasePlaceholder}
                    className="flex w-full rounded-md border border-memBorder-primary bg-surface-default-primary px-3 py-2 text-sm placeholder:text-onSurface-default-tertiary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-memPurple-500 min-h-[80px] resize-y"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  {t.setup.useCasePresets.map((preset) => (
                    <Button
                      key={preset}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setUseCase(preset)}
                      className={cn(
                        useCase === preset &&
                          "border-memPurple-500 text-memPurple-500",
                      )}
                    >
                      {preset}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-onSurface-default-tertiary">
                  {t.setup.instructionsHint}
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleContinueToQuickTest}
                    className="flex-1"
                  >
                    {t.setup.skip}
                  </Button>
                  <Button
                    type="button"
                    disabled={!useCase || isGeneratingInstructions}
                    className="flex-1"
                    onClick={async () => {
                      setError("");
                      setIsGeneratingInstructions(true);
                      try {
                        const res = await api.post(
                          MEMORY_ENDPOINTS.GENERATE_INSTRUCTIONS,
                          {
                            use_case: useCase,
                          },
                        );
                        setCustomInstructions(res.data.custom_instructions);
                        if (res.data.test_message) {
                          setTestMessage(res.data.test_message);
                        }
                      } catch (err) {
                        setError(
                          getErrorMessage(
                            err,
                            t.setup.errors.generateInstructions,
                          ),
                        );
                      } finally {
                        setIsGeneratingInstructions(false);
                      }
                    }}
                  >
                    {isGeneratingInstructions
                      ? t.setup.generatingInstructions
                      : t.setup.generateInstructions}
                  </Button>
                </div>
                {customInstructions && (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <Label htmlFor="setup-instructions">
                        {t.setup.generatedInstructions}
                      </Label>
                      <textarea
                        id="setup-instructions"
                        value={customInstructions}
                        onChange={(e) => setCustomInstructions(e.target.value)}
                        className="flex w-full rounded-md border border-memBorder-primary bg-surface-default-primary px-3 py-2 text-sm placeholder:text-onSurface-default-tertiary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-memPurple-500 min-h-[120px] resize-y"
                      />
                    </div>
                    <Button
                      type="button"
                      className="w-full"
                      onClick={async () => {
                        setError("");
                        setIsLoading(true);
                        try {
                          await api.post(MEMORY_ENDPOINTS.CONFIGURE, {
                            custom_instructions: customInstructions,
                          });
                          handleContinueToQuickTest();
                        } catch (err) {
                          setError(
                            getErrorMessage(
                              err,
                              t.setup.errors.saveInstructions,
                            ),
                          );
                        } finally {
                          setIsLoading(false);
                        }
                      }}
                      disabled={isLoading}
                    >
                      {isLoading ? t.common.saving : t.setup.saveAndContinue}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {step === 4 && (
              <form
                onSubmit={testSuccess ? handleGoToDashboard : handleTest}
                className="space-y-4"
              >
                <div className="space-y-1">
                  <Label>{t.setup.testLabel}</Label>
                  {!apiUrl && (
                    <p className="text-xs text-onSurface-danger-primary">
                      {t.setup.missingApiUrl}
                    </p>
                  )}
                  <pre className="text-xs bg-surface-default-secondary p-3 rounded font-mono overflow-x-auto">{`curl -X POST ${apiUrl}/memories \\
  -H "X-API-Key: ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"messages": [{"role": "user", "content": "${testMessage}"}], "user_id": "setup-test"}'`}</pre>
                </div>
                {!testSuccess ? (
                  <>
                    <Button
                      type="submit"
                      disabled={isLoading}
                      className="w-full"
                    >
                      {isLoading ? t.setup.testing : t.setup.runTest}
                    </Button>
                    {error && (
                      <p className="text-xs text-onSurface-default-tertiary">
                        {t.setup.fixConfigBefore}{" "}
                        <a
                          href="/dashboard/configuration"
                          className="underline underline-offset-4 hover:text-onSurface-default-primary"
                        >
                          {t.setup.configuration}
                        </a>{" "}
                        {t.setup.fixConfigAfter}
                      </p>
                    )}
                  </>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm text-onSurface-positive-primary">
                      <Check className="size-4" /> {t.setup.testSuccess}
                    </div>
                    <Button type="submit" className="w-full">
                      {t.setup.goToDashboard}
                    </Button>
                  </div>
                )}
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
