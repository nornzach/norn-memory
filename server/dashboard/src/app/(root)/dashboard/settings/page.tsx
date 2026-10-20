"use client";

import { FormEvent, useEffect, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { Loader2, LogOut, MonitorSmartphone, Trash2 } from "lucide-react";
import { useTheme } from "next-themes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Field } from "@/components/shared/field";
import {
  PageHeader,
  Panel,
  PanelBody,
  PanelFooter,
  PanelHeader,
} from "@/components/shared/page";
import { toast } from "@/components/ui/use-toast";
import { useApiQuery } from "@/hooks/use-api-query";
import { useAuth } from "@/hooks/use-auth";
import { getErrorMessage } from "@/lib/error-message";
import { api, getAccessToken } from "@/utils/api";
import { AUTH_ENDPOINTS, MEMORY_ENDPOINTS } from "@/utils/api-endpoints";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/i18n/config";
import { useI18n } from "@/i18n/provider";

type ThemeChoice = "light" | "dark" | "system";

export default function SettingsPage() {
  const { user, refreshUser } = useAuth();
  const { theme, setTheme } = useTheme();
  const { t, locale, setLocale, dateLocale } = useI18n();
  const [mounted, setMounted] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  const [signingOut, setSigningOut] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  const sessions = useApiQuery(async () => {
    const res = await api.get<{ active: number }>(AUTH_ENDPOINTS.SESSIONS);
    return res.data.active;
  });

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (user) {
      setName(user.name);
      setEmail(user.email);
    }
  }, [user]);

  const profileDirty =
    user !== null && (name !== user.name || email !== user.email);
  const profileValid = name.trim().length > 0 && email.trim().length > 0;
  const mismatch =
    confirmPassword.length > 0 && newPassword !== confirmPassword;
  const canChangePassword =
    currentPassword.length > 0 &&
    newPassword.length >= 8 &&
    newPassword === confirmPassword &&
    !savingPassword;
  const confirmWord = t.settings.deleteAllConfirmWord;

  const handleSaveProfile = async (event: FormEvent) => {
    event.preventDefault();
    if (!profileDirty || !profileValid || savingProfile) return;
    setSavingProfile(true);
    try {
      await api.patch(AUTH_ENDPOINTS.ME, {
        name: name.trim(),
        email: email.trim(),
      });
      await refreshUser();
      toast({ title: t.settings.profileUpdated, variant: "success" });
    } catch (error) {
      toast({
        title: t.settings.profileFailed,
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!canChangePassword) return;
    setSavingPassword(true);
    try {
      await api.post(AUTH_ENDPOINTS.CHANGE_PASSWORD, {
        current_password: currentPassword,
        new_password: newPassword,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast({ title: t.settings.passwordUpdated, variant: "success" });
    } catch (error) {
      toast({
        title: t.settings.passwordFailed,
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setSavingPassword(false);
    }
  };

  const handleSignOutOthers = async () => {
    setSigningOut(true);
    try {
      // This browser's refresh token is in an httpOnly cookie, so a route handler forwards it.
      const res = await fetch("/api/auth/sign-out-others", {
        method: "POST",
        headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || res.statusText);
      toast({
        title: t.settings.signedOutOthers(data.signed_out ?? 0),
        variant: "success",
      });
      await sessions.refetch();
    } catch (error) {
      toast({
        title: t.settings.signOutOthersFailed,
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setSigningOut(false);
    }
  };

  const handleDeleteAll = async (event: FormEvent) => {
    event.preventDefault();
    if (confirmText !== confirmWord || deleting) return;
    setDeleting(true);
    try {
      await api.post(MEMORY_ENDPOINTS.RESET);
      toast({ title: t.settings.deleteAllDone, variant: "success" });
      setConfirmOpen(false);
    } catch (error) {
      toast({
        title: t.settings.deleteAllFailed,
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  const themeValue: ThemeChoice =
    mounted && (theme === "light" || theme === "dark") ? theme : "system";
  const initial = user?.name?.charAt(0).toUpperCase() || "?";
  const activeSessions = sessions.data ?? 1;

  return (
    <>
      <PageHeader title={t.settings.title} description={t.settings.subtitle} />

      <div className="grid max-w-3xl grid-cols-1 gap-4 sm:gap-6">
        <Panel id="profile" className="scroll-mt-24">
          <div className="flex items-center gap-4 border-b border-line bg-sunken/60 px-5 py-5 sm:px-6">
            <span
              aria-hidden
              className="grid size-14 shrink-0 place-items-center rounded-full bg-brand-soft font-serif text-2xl text-brand-text"
            >
              {initial}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate font-serif text-[22px] leading-7 text-ink">
                  {user?.name}
                </h2>
                {user?.role === "admin" && (
                  <Badge variant="brand">{t.settings.roleAdmin}</Badge>
                )}
              </div>
              <p className="truncate text-sm text-ink-2">{user?.email}</p>
              {user && (
                <p className="mt-1 text-xs text-ink-3">
                  {t.settings.memberSince(
                    format(new Date(user.created_at), "PP", {
                      locale: dateLocale,
                    }),
                  )}
                  {user.last_login_at && (
                    <>
                      {" · "}
                      {t.settings.lastSignIn(
                        formatDistanceToNow(new Date(user.last_login_at), {
                          addSuffix: true,
                          locale: dateLocale,
                        }),
                      )}
                    </>
                  )}
                </p>
              )}
            </div>
          </div>
          <form onSubmit={handleSaveProfile}>
            <PanelHeader
              title={t.settings.profile}
              description={t.settings.profileDescription}
              className="border-b-0 pb-0 sm:pb-0"
            />
            <PanelBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field id="settings-name" label={t.common.name}>
                <Input
                  id="settings-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                />
              </Field>
              <Field id="settings-email" label={t.common.email}>
                <Input
                  id="settings-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </Field>
            </PanelBody>
            <PanelFooter className="sm:justify-end">
              <Button
                type="submit"
                disabled={!profileDirty || !profileValid || savingProfile}
                className="w-full sm:w-auto"
              >
                {savingProfile && (
                  <Loader2 className="animate-spin" aria-hidden />
                )}
                {savingProfile ? t.common.saving : t.settings.saveProfile}
              </Button>
            </PanelFooter>
          </form>
        </Panel>

        <Panel>
          <form onSubmit={handleChangePassword}>
            <PanelHeader
              title={t.settings.password}
              description={t.settings.passwordDescription}
            />
            <PanelBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* Lets password managers pair the fields with this account. */}
              <input
                type="text"
                name="username"
                autoComplete="username"
                value={user?.email ?? ""}
                readOnly
                hidden
              />
              <Field
                id="settings-current-password"
                label={t.settings.currentPassword}
                className="sm:col-span-2"
              >
                <Input
                  id="settings-current-password"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                  className="sm:max-w-[calc(50%-0.5rem)]"
                />
              </Field>
              <Field id="settings-new-password" label={t.settings.newPassword}>
                <Input
                  id="settings-new-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={t.settings.newPasswordPlaceholder}
                  autoComplete="new-password"
                  minLength={8}
                />
              </Field>
              <Field
                id="settings-confirm-password"
                label={t.settings.confirmNewPassword}
                error={mismatch ? t.settings.passwordMismatch : undefined}
              >
                <Input
                  id="settings-confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  aria-invalid={mismatch}
                />
              </Field>
            </PanelBody>
            <PanelFooter className="sm:justify-end">
              <Button
                type="submit"
                disabled={!canChangePassword}
                className="w-full sm:w-auto"
              >
                {savingPassword && (
                  <Loader2 className="animate-spin" aria-hidden />
                )}
                {savingPassword ? t.common.saving : t.settings.updatePassword}
              </Button>
            </PanelFooter>
          </form>
        </Panel>

        <Panel>
          <PanelHeader
            title={t.settings.sessions}
            description={t.settings.sessionsDescription}
          />
          <PanelBody className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-subtle text-ink-3">
                <MonitorSmartphone className="size-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-sm text-ink">
                  {sessions.isLoading
                    ? t.common.loading
                    : t.settings.sessionsCount(activeSessions)}
                </p>
                <p className="mt-0.5 text-xs leading-5 text-ink-3">
                  {t.settings.signOutOthersHint}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              onClick={() => void handleSignOutOthers()}
              disabled={signingOut || activeSessions <= 1}
              className="w-full sm:w-auto"
            >
              {signingOut ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <LogOut aria-hidden />
              )}
              {t.settings.signOutOthers}
            </Button>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader
            title={t.settings.appearance}
            description={t.settings.appearanceDescription}
          />
          <PanelBody className="divide-y divide-line p-0 sm:p-0">
            <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <span className="text-sm font-medium text-ink">
                {t.settings.theme}
              </span>
              <Segmented<ThemeChoice>
                label={t.settings.theme}
                value={themeValue}
                onChange={setTheme}
                options={[
                  { value: "light", label: t.settings.themes.light },
                  { value: "dark", label: t.settings.themes.dark },
                  { value: "system", label: t.settings.themes.system },
                ]}
                className="w-full sm:w-72"
              />
            </div>
            <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <span className="text-sm font-medium text-ink">
                {t.settings.language}
              </span>
              <Segmented<Locale>
                label={t.settings.language}
                value={locale}
                onChange={(next) => next !== locale && setLocale(next)}
                options={LOCALES.map((option) => ({
                  value: option,
                  label: LOCALE_LABELS[option],
                }))}
                className="w-full sm:w-72"
              />
            </div>
          </PanelBody>
        </Panel>

        <Panel className="border-danger/30">
          <PanelHeader
            title={t.settings.dangerZone}
            description={t.settings.dangerDescription}
          />
          <PanelBody className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">
                {t.settings.deleteAll}
              </p>
              <p className="mt-0.5 text-xs leading-5 text-ink-3">
                {t.settings.deleteAllDescription}
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => {
                setConfirmText("");
                setConfirmOpen(true);
              }}
              className="w-full border-danger/40 text-danger hover:border-danger/60 hover:bg-danger-soft sm:w-auto"
            >
              <Trash2 aria-hidden />
              {t.settings.deleteAll}
            </Button>
          </PanelBody>
        </Panel>
      </div>

      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => !deleting && setConfirmOpen(open)}
      >
        <DialogContent className="max-w-md">
          <form onSubmit={handleDeleteAll} className="grid gap-5">
            <DialogHeader>
              <DialogTitle>{t.settings.deleteAllConfirmTitle}</DialogTitle>
              <DialogDescription>
                {t.settings.deleteAllConfirmBody(confirmWord)}
              </DialogDescription>
            </DialogHeader>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={confirmWord}
              aria-label={t.settings.deleteAllConfirmBody(confirmWord)}
              autoComplete="off"
              autoFocus
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirmOpen(false)}
                disabled={deleting}
              >
                {t.common.cancel}
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={confirmText !== confirmWord || deleting}
              >
                {deleting && <Loader2 className="animate-spin" aria-hidden />}
                {t.settings.deleteAll}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
