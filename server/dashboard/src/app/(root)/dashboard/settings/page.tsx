"use client";

import { useEffect, useState } from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { getErrorMessage } from "@/lib/error-message";
import { api } from "@/utils/api";
import { AUTH_ENDPOINTS } from "@/utils/api-endpoints";
import { LanguageSwitcher } from "@/components/misc/language-switcher";
import { useI18n } from "@/i18n/provider";

export default function SettingsPage() {
  const { user, refreshUser } = useAuth();
  const { setTheme } = useTheme();
  const { t } = useI18n();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    if (user) {
      setName(user.name);
      setEmail(user.email);
    }
  }, [user]);

  const profileDirty =
    user !== null && (name !== user.name || email !== user.email);
  const profileValid = name.trim().length > 0 && email.trim().length > 0;

  const handleSaveProfile = async () => {
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

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast({
        title: t.settings.passwordMismatch,
        variant: "destructive",
      });
      return;
    }

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

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold font-fustat">{t.settings.title}</h1>

      <Card className="border-memBorder-primary">
        <CardHeader>
          <CardTitle className="text-sm">{t.settings.profile}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="settings-name" className="text-xs">
                {t.common.name}
              </Label>
              <Input
                id="settings-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="settings-email" className="text-xs">
                {t.common.email}
              </Label>
              <Input
                id="settings-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>
          <Button
            onClick={handleSaveProfile}
            disabled={!profileDirty || !profileValid || savingProfile}
          >
            {savingProfile ? t.common.saving : t.settings.saveProfile}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-memBorder-primary">
        <CardHeader>
          <CardTitle className="text-sm">{t.settings.password}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="settings-current-password" className="text-xs">
              {t.settings.currentPassword}
            </Label>
            <Input
              id="settings-current-password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="settings-new-password" className="text-xs">
                {t.settings.newPassword}
              </Label>
              <Input
                id="settings-new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={t.settings.newPasswordPlaceholder}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="settings-confirm-password" className="text-xs">
                {t.settings.confirmNewPassword}
              </Label>
              <Input
                id="settings-confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
          </div>
          <Button
            onClick={handleChangePassword}
            disabled={
              !currentPassword ||
              newPassword.length < 8 ||
              !confirmPassword ||
              savingPassword
            }
          >
            {savingPassword ? t.common.saving : t.settings.updatePassword}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-memBorder-primary">
        <CardHeader>
          <CardTitle className="text-sm">{t.settings.appearance}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <span className="text-sm text-onSurface-default-secondary">
              {t.settings.theme}
            </span>
            <button
              onClick={() => setTheme("light")}
              aria-label={t.settings.themes.light}
              title={t.settings.themes.light}
              className="p-2 rounded hover:bg-surface-default-secondary-hover"
            >
              <Sun className="size-4" />
            </button>
            <button
              onClick={() => setTheme("dark")}
              aria-label={t.settings.themes.dark}
              title={t.settings.themes.dark}
              className="p-2 rounded hover:bg-surface-default-secondary-hover"
            >
              <Moon className="size-4" />
            </button>
            <button
              onClick={() => setTheme("system")}
              aria-label={t.settings.themes.system}
              title={t.settings.themes.system}
              className="p-2 rounded hover:bg-surface-default-secondary-hover"
            >
              <Monitor className="size-4" />
            </button>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-onSurface-default-secondary">
              {t.settings.language}
            </span>
            <LanguageSwitcher />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
