"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { AuthFrame } from "@/components/auth/auth-frame";
import { CopyButton } from "@/components/misc/copy-button";
import { Field } from "@/components/shared/field";
import { useAuth } from "@/hooks/use-auth";
import { getErrorMessage } from "@/lib/error-message";
import { isValidEmail } from "@/lib/validators";
import { useI18n } from "@/i18n/provider";

const RESET_COMMAND =
  "make reset-admin-password EMAIL=<your-email> PASSWORD=<new-password>";

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isLoading, login } = useAuth();
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isLoading && user) {
      router.push(searchParams.get("next") || "/dashboard/requests");
    }
  }, [user, isLoading, router, searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError("");
    if (!isValidEmail(email)) {
      setError(t.login.invalidEmail);
      return;
    }
    setSubmitting(true);
    try {
      await login(email, password);
      router.push(searchParams.get("next") || "/dashboard/requests");
    } catch (err) {
      setError(getErrorMessage(err, t.login.failed));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleLabel = showPassword
    ? t.login.hidePassword
    : t.login.showPassword;

  return (
    <AuthFrame>
      <div className="rounded-2xl border border-line bg-panel p-6 shadow-elev-2 sm:p-8">
        <div className="mb-6 space-y-1.5">
          <h1 className="font-serif text-[26px] font-normal leading-tight text-ink">
            {t.login.title}
          </h1>
          <p className="text-sm text-ink-3">{t.login.subtitle}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {error && (
            <p
              className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger"
              role="alert"
            >
              {error}
            </p>
          )}
          <Field id="login-email" label={t.common.email}>
            <Input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@company.com"
              autoComplete="username"
              autoFocus
              required
            />
          </Field>
          <Field id="login-password" label={t.common.password}>
            <div className="relative">
              <Input
                id="login-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="pr-10"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={toggleLabel}
                title={toggleLabel}
                aria-pressed={showPassword}
                className="absolute right-1 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-ink-3 transition-colors hover:bg-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--focus)]"
              >
                {showPassword ? (
                  <EyeOff className="size-4" aria-hidden />
                ) : (
                  <Eye className="size-4" aria-hidden />
                )}
              </button>
            </div>
          </Field>
          <Button
            type="submit"
            disabled={submitting || !email || !password}
            size="lg"
            className="w-full"
          >
            {submitting && <Loader2 className="animate-spin" aria-hidden />}
            {submitting ? t.login.signingIn : t.login.signIn}
          </Button>
        </form>

        <div className="mt-5 text-center">
          <Dialog>
            <DialogTrigger asChild>
              <button
                type="button"
                className="rounded text-sm text-ink-3 underline-offset-4 transition-colors hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--focus)]"
              >
                {t.login.forgotPassword}
              </button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>{t.login.resetTitle}</DialogTitle>
                <DialogDescription>
                  {t.login.resetDescription}
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-start gap-2 rounded-lg border border-line bg-sunken py-2 pl-3 pr-1.5">
                <code className="min-w-0 flex-1 whitespace-pre-wrap break-all py-1 font-mono text-xs leading-5 text-ink-2">
                  {RESET_COMMAND}
                </code>
                <CopyButton
                  text={RESET_COMMAND}
                  label={t.setup.copyCommand}
                  className="size-8 shrink-0"
                />
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </AuthFrame>
  );
}
