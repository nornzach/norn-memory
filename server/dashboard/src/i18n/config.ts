// Shared by server layouts and client code, so nothing here may touch the DOM or next/headers.

export const LOCALES = ["en", "zh"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "mem0_locale";

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  zh: "中文",
};

// Value for <html lang>.
export const HTML_LANG: Record<Locale, string> = {
  en: "en",
  zh: "zh-CN",
};

export function isLocale(value: unknown): value is Locale {
  return LOCALES.includes(value as Locale);
}

/** The saved choice wins; otherwise the browser's first supported language. */
export function resolveLocale(
  saved: string | undefined | null,
  acceptLanguage: string | undefined | null,
): Locale {
  if (isLocale(saved)) return saved;
  for (const part of (acceptLanguage ?? "").split(",")) {
    const tag = part.split(";")[0].trim().toLowerCase();
    if (tag.startsWith("zh")) return "zh";
    if (tag.startsWith("en")) return "en";
  }
  return DEFAULT_LOCALE;
}
