import "@/styles/globals.css";
import React from "react";
import { Inter, InterDisplay, Roboto, Fustat, DMMono } from "../(root)/fonts";
import { cn } from "@/lib/utils";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/lib/auth";
import { HTML_LANG } from "@/i18n/config";
import { I18nProvider } from "@/i18n/provider";
import { getServerLocale, getServerMessages } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getServerMessages();
  return { title: t.meta.login, description: t.meta.loginDescription };
}

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getServerLocale();
  return (
    <html
      lang={HTML_LANG[locale]}
      className={cn(
        Fustat.variable,
        InterDisplay.variable,
        Inter.variable,
        Roboto.variable,
        DMMono.variable,
      )}
      suppressHydrationWarning
    >
      <body className="font-sans" suppressHydrationWarning>
        <I18nProvider initialLocale={locale}>
          <AuthProvider>
            <ThemeProvider
              attribute="class"
              defaultTheme="system"
              enableSystem
              disableTransitionOnChange
            >
              {children}
            </ThemeProvider>
          </AuthProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
