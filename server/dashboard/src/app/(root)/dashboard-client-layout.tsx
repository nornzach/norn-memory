"use client";

import React from "react";
import { ThemeProvider } from "@/components/theme-provider";
import "@/styles/globals.css";
import { ClientLayout } from "./clientLayout";
import { cn } from "@/lib/utils";
import { Inter, InterDisplay, Roboto, Fustat, DMMono } from "./fonts";
import { Provider } from "react-redux";
import store from "@/store/store";
import { AuthProvider } from "@/lib/auth";
import dynamic from "next/dynamic";
import { HTML_LANG, Locale } from "@/i18n/config";
import { I18nProvider } from "@/i18n/provider";

const Toaster = dynamic(
  () =>
    import("@/components/ui/sonner").then((mod) => ({ default: mod.Toaster })),
  {
    ssr: false,
  },
);

export function DashboardClientLayout({
  locale,
  children,
}: Readonly<{
  locale: Locale;
  children: React.ReactNode;
}>) {
  return (
    <html lang={HTML_LANG[locale]} suppressHydrationWarning>
      <body
        className={cn(
          Inter.className,
          InterDisplay.variable,
          Roboto.variable,
          Fustat.variable,
          DMMono.variable,
        )}
        suppressHydrationWarning
      >
        <Provider store={store}>
          <I18nProvider initialLocale={locale}>
            <AuthProvider>
              <ThemeProvider
                attribute="class"
                defaultTheme="light"
                enableSystem
                disableTransitionOnChange
              >
                <ClientLayout>{children}</ClientLayout>
                <Toaster />
              </ThemeProvider>
            </AuthProvider>
          </I18nProvider>
        </Provider>
      </body>
    </html>
  );
}
