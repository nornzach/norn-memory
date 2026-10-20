"use client";

import { Languages } from "lucide-react";
import { cn } from "@/lib/utils";
import { LOCALES, LOCALE_LABELS } from "@/i18n/config";
import { useI18n } from "@/i18n/provider";

/** Two-option segmented switch: English / 中文. */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <div
      role="radiogroup"
      aria-label={t.common.language}
      className={cn(
        "inline-flex h-8 items-center gap-0.5 rounded-lg border border-line bg-panel p-0.5 text-xs shadow-elev-1",
        className,
      )}
    >
      <Languages className="mx-1 size-3.5 text-ink-3" aria-hidden />
      {LOCALES.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={locale === option}
          onClick={() => locale !== option && setLocale(option)}
          className={cn(
            "h-full rounded-md px-2 font-medium transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--focus)]",
            locale === option
              ? "bg-subtle text-ink"
              : "text-ink-3 hover:text-ink",
          )}
        >
          {LOCALE_LABELS[option]}
        </button>
      ))}
    </div>
  );
}
