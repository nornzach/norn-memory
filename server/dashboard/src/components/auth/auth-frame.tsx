"use client";

import { ReactNode } from "react";
import { LanguageSwitcher } from "@/components/misc/language-switcher";
import { NornMark } from "@/components/misc/norn-mark";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/provider";

const INSTANCE_NAME = process.env.NEXT_PUBLIC_INSTANCE_NAME || "Norn-M";

/** Page frame for sign-in and first-run setup: brand bar, centered content, tagline. */
export function AuthFrame({
  children,
  width = "narrow",
}: {
  children: ReactNode;
  width?: "narrow" | "wide";
}) {
  const { t } = useI18n();
  return (
    <div className="relative flex min-h-dvh flex-col overflow-x-hidden bg-canvas">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(60%_100%_at_50%_0%,var(--brand-soft),transparent)] opacity-70"
      />
      <header className="relative flex items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <NornMark size={28} />
          <span className="truncate font-serif text-[19px] text-ink">
            {INSTANCE_NAME}
          </span>
        </div>
        <LanguageSwitcher />
      </header>
      <main className="relative flex flex-1 justify-center px-4 pb-10 pt-4 sm:items-center sm:px-6 sm:pt-0">
        <div
          className={cn(
            "w-full",
            width === "wide" ? "max-w-[640px]" : "max-w-[400px]",
          )}
        >
          {children}
        </div>
      </main>
      <footer className="relative px-4 pb-6 text-center text-xs leading-5 text-ink-3">
        {t.login.tagline} {t.login.taglineDetail}
      </footer>
    </div>
  );
}
