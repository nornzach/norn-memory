"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  CircleCheck,
  KeyRound,
  Loader2,
  PlugZap,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AuthFrame } from "@/components/auth/auth-frame";
import { CopyButton } from "@/components/misc/copy-button";
import { Field } from "@/components/shared/field";
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

  const handleGenerateInstructions = async () => {
    setError("");
    setIsGeneratingInstructions(true);
    try {
      const res = await api.post(MEMORY_ENDPOINTS.GENERATE_INSTRUCTIONS, {
        use_case: useCase,
      });
      setCustomInstructions(res.data.custom_instructions);
      if (res.data.test_message) {
        setTestMessage(res.data.test_message);
      }
    } catch (err) {
      setError(getErrorMessage(err, t.setup.errors.generateInstructions));
    } finally {
      setIsGeneratingInstructions(false);
    }
  };

  const handleSaveInstructions = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      await api.post(MEMORY_ENDPOINTS.CONFIGURE, {
        custom_instructions: customInstructions,
      });
      handleContinueToQuickTest();
    } catch (err) {
      setError(getErrorMessage(err, t.setup.errors.saveInstructions));
    } finally {
      setIsLoading(false);
    }
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

  const totalSteps = t.setup.steps.length;
  // Single-quoted for the shell, so quotes in the test message can't break the command.
  const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
  const curlCommand = [
    `curl -X POST ${apiUrl || "<API_URL>"}/memories`,
    `  -H "X-API-Key: ${apiKey}"`,
    `  -H "Content-Type: application/json"`,
    `  -d ${shellQuote(
      JSON.stringify({
        messages: [{ role: "user", content: testMessage }],
        user_id: "setup-test",
      }),
    )}`,
  ].join(" \\\n");

  const actions = "flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end";

  return (
    <AuthFrame width="wide">
      <ol className="mb-4 grid grid-cols-5 gap-1.5 sm:gap-2">
        {t.setup.steps.map((label, i) => (
          <li
            key={label}
            aria-current={i === step ? "step" : undefined}
            className="min-w-0"
          >
            <span
              className={cn(
                "block h-1 rounded-full transition-colors",
                i <= step ? "bg-brand" : "bg-line-strong",
              )}
              aria-hidden
            />
            <span
              className={cn(
                "mt-2 hidden items-center gap-1 truncate text-xs sm:flex",
                i === step
                  ? "font-medium text-ink"
                  : i < step
                    ? "text-ink-2"
                    : "text-ink-3",
              )}
            >
              {i < step && (
                <Check className="size-3 shrink-0 text-brand" aria-hidden />
              )}
              <span className="truncate">{label}</span>
            </span>
            <span className="sr-only sm:hidden">{label}</span>
          </li>
        ))}
      </ol>

      <div className="overflow-hidden rounded-2xl border border-line bg-panel shadow-elev-2">
        <div className="border-b border-line px-5 py-5 sm:px-8 sm:py-6">
          <p className="text-xs font-medium text-brand-text">
            {t.setup.stepOf(step + 1, totalSteps)}
            <span className="sm:hidden"> · {t.setup.steps[step]}</span>
          </p>
          <h1 className="mt-1.5 font-serif text-[26px] font-normal leading-tight text-ink">
            {t.setup.stepTitles[step]}
          </h1>
          <p className="mt-1 text-sm leading-6 text-ink-3">
            {t.setup.stepDescriptions[step]}
          </p>
        </div>

        <div className="space-y-5 px-5 py-5 sm:px-8 sm:py-6">
          {error && (
            <p
              className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger"
              role="alert"
            >
              {error}
            </p>
          )}

          {step === 0 && (
            <form onSubmit={handleStep1} className="space-y-4">
              <Field id="setup-name" label={t.common.name}>
                <Input
                  id="setup-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t.setup.namePlaceholder}
                  autoComplete="name"
                  autoFocus
                />
              </Field>
              <Field id="setup-email" label={t.common.email}>
                <Input
                  id="setup-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@company.com"
                  autoComplete="username"
                />
              </Field>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field id="setup-password" label={t.common.password}>
                  <Input
                    id="setup-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t.setup.passwordPlaceholder}
                    autoComplete="new-password"
                  />
                </Field>
                <Field
                  id="setup-confirm-password"
                  label={t.setup.confirmPassword}
                  error={
                    confirmPassword && password !== confirmPassword
                      ? t.setup.errors.passwordMismatch
                      : undefined
                  }
                >
                  <Input
                    id="setup-confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                </Field>
              </div>
              <div className={actions}>
                <Button
                  type="submit"
                  disabled={isLoading || !name || !email || !password}
                  className="sm:min-w-40"
                >
                  {isLoading && (
                    <Loader2 className="animate-spin" aria-hidden />
                  )}
                  {isLoading ? t.setup.creating : t.setup.createAdmin}
                </Button>
              </div>
            </form>
          )}

          {step === 1 && (
            <form
              onSubmit={handleStep2}
              className={cn("space-y-5", isPrefillingConfig && "opacity-60")}
              aria-busy={isPrefillingConfig}
            >
              {isPrefillingConfig && (
                <p
                  className="flex items-center gap-2 text-sm text-ink-3"
                  role="status"
                >
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  {t.setup.checkingConfig}
                </p>
              )}
              {!isPrefillingConfig && !serverHasLlmKey && (
                <p className="rounded-lg bg-info-soft px-3 py-2.5 text-sm leading-5 text-info">
                  {t.setup.noLlmKey}
                </p>
              )}

              <section className="space-y-4">
                <h2 className="text-[13px] font-semibold text-ink">
                  {t.setup.llmProvider}
                </h2>
                <ProviderFields
                  {...providerFieldProps("llm")}
                  keyLabel={t.setup.llmApiKey}
                  keyPlaceholder={
                    serverHasLlmKey && sameEndpoint(saved.llm, forms.llm)
                      ? t.setup.keepExistingKey
                      : undefined
                  }
                  keyHint={t.setup.sharedKeyHint}
                />
              </section>

              <section className="space-y-4 border-t border-line pt-5">
                <h2 className="text-[13px] font-semibold text-ink">
                  {t.setup.embedderProvider}
                </h2>
                <ProviderFields
                  {...providerFieldProps("embedder")}
                  keyPlaceholder={
                    forms.llm.apiKey.trim() &&
                    sameEndpoint(forms.llm, forms.embedder)
                      ? t.setup.reuseLlmKey
                      : undefined
                  }
                />
              </section>

              <p className="text-xs leading-5 text-ink-3">
                {t.setup.otherProviderBefore}
                <a
                  href={SUPPORTED_PROVIDERS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-brand-text underline-offset-4 hover:underline"
                >
                  {t.setup.supportedProviders}
                </a>
                {t.setup.otherProviderAfter}
              </p>

              <div className={actions}>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleTestProviders}
                  disabled={isLoading || isTesting || !providersReady}
                >
                  {isTesting ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <PlugZap aria-hidden />
                  )}
                  {isTesting
                    ? t.configuration.testing
                    : t.configuration.testConnection}
                </Button>
                <Button
                  type="submit"
                  disabled={isLoading || isTesting || !providersReady}
                  className="sm:min-w-40"
                >
                  {isLoading && (
                    <Loader2 className="animate-spin" aria-hidden />
                  )}
                  {isLoading ? t.common.saving : t.setup.saveAndContinue}
                </Button>
              </div>
            </form>
          )}

          {step === 2 && !apiKey && (
            <form onSubmit={handleStep3} className="space-y-4">
              <Field id="setup-key-label" label={t.setup.keyLabel}>
                <Input
                  id="setup-key-label"
                  value={keyLabel}
                  onChange={(e) => setKeyLabel(e.target.value)}
                  placeholder={t.setup.defaultKeyLabel}
                  autoComplete="off"
                />
              </Field>
              <div className={actions}>
                <Button
                  type="submit"
                  disabled={isLoading}
                  className="sm:min-w-40"
                >
                  {isLoading ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <KeyRound aria-hidden />
                  )}
                  {isLoading ? t.setup.generating : t.setup.generateKey}
                </Button>
              </div>
            </form>
          )}

          {step === 2 && apiKey && (
            <form onSubmit={handleContinueToUseCase} className="space-y-4">
              <Field
                id="setup-api-key"
                label={t.setup.yourKey}
                hint={
                  <span className="text-ink-3">{t.setup.saveKeyWarning}</span>
                }
              >
                <div className="flex items-center gap-1 rounded-lg border border-line bg-sunken py-1 pl-3 pr-1">
                  <input
                    id="setup-api-key"
                    value={apiKey}
                    readOnly
                    onFocus={(e) => e.target.select()}
                    className="min-w-0 flex-1 bg-transparent font-mono text-sm text-ink outline-none"
                  />
                  <CopyButton
                    text={apiKey}
                    label={t.common.copy}
                    showLabel
                    variant="outline"
                    size="sm"
                  />
                </div>
              </Field>
              <div className={actions}>
                <Button type="submit" className="sm:min-w-40">
                  {t.common.continue}
                  <ArrowRight aria-hidden />
                </Button>
              </div>
            </form>
          )}

          {step === 3 && (
            <form onSubmit={handleSaveInstructions} className="space-y-4">
              <Field
                id="setup-use-case"
                label={t.setup.describeUseCase}
                hint={t.setup.instructionsHint}
              >
                <Textarea
                  id="setup-use-case"
                  value={useCase}
                  onChange={(e) => setUseCase(e.target.value)}
                  placeholder={t.setup.useCasePlaceholder}
                  className="min-h-[88px]"
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                {t.setup.useCasePresets.map((preset) => {
                  const active = useCase === preset;
                  return (
                    <button
                      key={preset}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setUseCase(preset)}
                      className={cn(
                        "h-8 rounded-full border px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--focus)]",
                        active
                          ? "border-brand bg-brand-soft text-brand-text"
                          : "border-line text-ink-2 hover:bg-subtle",
                      )}
                    >
                      {preset}
                    </button>
                  );
                })}
              </div>

              {customInstructions && (
                <Field
                  id="setup-instructions"
                  label={t.setup.generatedInstructions}
                >
                  <Textarea
                    id="setup-instructions"
                    value={customInstructions}
                    onChange={(e) => setCustomInstructions(e.target.value)}
                    className="min-h-[160px]"
                  />
                </Field>
              )}

              <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:items-center">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleContinueToQuickTest}
                  className="text-ink-3 sm:mr-auto"
                >
                  {t.setup.skip}
                </Button>
                <Button
                  type="button"
                  variant={customInstructions ? "outline" : "default"}
                  disabled={!useCase.trim() || isGeneratingInstructions}
                  onClick={handleGenerateInstructions}
                >
                  {isGeneratingInstructions ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <Sparkles aria-hidden />
                  )}
                  {isGeneratingInstructions
                    ? t.setup.generatingInstructions
                    : t.setup.generateInstructions}
                </Button>
                {customInstructions && (
                  <Button
                    type="submit"
                    disabled={isLoading || isGeneratingInstructions}
                  >
                    {isLoading && (
                      <Loader2 className="animate-spin" aria-hidden />
                    )}
                    {isLoading ? t.common.saving : t.setup.saveAndContinue}
                  </Button>
                )}
              </div>
            </form>
          )}

          {step === 4 && (
            <form
              onSubmit={testSuccess ? handleGoToDashboard : handleTest}
              className="space-y-4"
            >
              {!apiUrl && (
                <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
                  {t.setup.missingApiUrl}
                </p>
              )}
              <Field
                id="setup-test-message"
                label={t.memories.contentLabel}
                hint={t.setup.testUser}
              >
                <Input
                  id="setup-test-message"
                  value={testMessage}
                  onChange={(e) => setTestMessage(e.target.value)}
                  disabled={testSuccess}
                  autoComplete="off"
                />
              </Field>
              <div className="relative rounded-lg border border-line bg-sunken">
                <pre className="scrollbar-thin overflow-x-auto whitespace-pre-wrap break-all p-3 pr-12 font-mono text-xs leading-5 text-ink-2">
                  {curlCommand}
                </pre>
                <CopyButton
                  text={curlCommand}
                  label={t.setup.copyCommand}
                  className="absolute right-1.5 top-1.5 size-8"
                />
              </div>

              {testSuccess ? (
                <>
                  <p
                    className="flex items-center gap-2 rounded-lg bg-success-soft px-3 py-2.5 text-sm font-medium text-success"
                    role="status"
                  >
                    <CircleCheck className="size-4 shrink-0" aria-hidden />
                    {t.setup.testSuccess}
                  </p>
                  <div className={actions}>
                    <Button type="submit" className="sm:min-w-40">
                      {t.setup.goToDashboard}
                      <ArrowRight aria-hidden />
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  {error && (
                    <p className="text-xs leading-5 text-ink-3">
                      {t.setup.fixConfigBefore}{" "}
                      <a
                        href="/dashboard/configuration"
                        className="font-medium text-brand-text underline-offset-4 hover:underline"
                      >
                        {t.setup.configuration}
                      </a>{" "}
                      {t.setup.fixConfigAfter}
                    </p>
                  )}
                  <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:items-center">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => router.push("/dashboard/requests")}
                      className="text-ink-3 sm:mr-auto"
                    >
                      {t.setup.skipTest}
                    </Button>
                    <Button
                      type="submit"
                      disabled={isLoading || !testMessage.trim()}
                      className="sm:min-w-40"
                    >
                      {isLoading && (
                        <Loader2 className="animate-spin" aria-hidden />
                      )}
                      {isLoading ? t.setup.testing : t.setup.runTest}
                    </Button>
                  </div>
                </>
              )}
            </form>
          )}
        </div>
      </div>
    </AuthFrame>
  );
}
