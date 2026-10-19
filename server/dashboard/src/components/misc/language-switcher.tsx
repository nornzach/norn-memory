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
        "inline-flex items-center gap-0.5 rounded-md border border-memBorder-primary p-0.5 text-xs",
        className,
      )}
    >
      <Languages
        className="mx-1 size-3.5 text-onSurface-default-tertiary"
        aria-hidden
      />
      {LOCALES.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={locale === option}
          onClick={() => locale !== option && setLocale(option)}
          className={cn(
            "rounded px-1.5 py-0.5 transition-colors",
            locale === option
              ? "bg-surface-default-tertiary text-onSurface-default-primary font-medium"
              : "text-onSurface-default-tertiary hover:text-onSurface-default-secondary",
          )}
        >
          {LOCALE_LABELS[option]}
        </button>
      ))}
    </div>
  );
}
