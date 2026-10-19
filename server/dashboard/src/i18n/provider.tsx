"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { enUS, zhCN, type Locale as DateLocale } from "date-fns/locale";
import { HTML_LANG, LOCALE_COOKIE, Locale } from "./config";
import { Messages, messages } from "./messages";

const DATE_LOCALES: Record<Locale, DateLocale> = { en: enUS, zh: zhCN };
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Messages;
  /** Pass to date-fns `format` / `formatDistanceToNow` as `{ locale: dateLocale }`. */
  dateLocale: DateLocale;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback(
    (next: Locale) => {
      document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
      document.documentElement.lang = HTML_LANG[next];
      setLocaleState(next);
      // Server-rendered bits (page titles) read the cookie, so refresh them too.
      router.refresh();
    },
    [router],
  );

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      t: messages[locale],
      dateLocale: DATE_LOCALES[locale],
    }),
    [locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used inside <I18nProvider>.");
  }
  return context;
}
