import "@/styles/globals.css";
import { Inter, Fustat, Roboto, DMMono, InterDisplay } from "../(root)/fonts";
import { cn } from "@/lib/utils";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/lib/auth";
import { HTML_LANG } from "@/i18n/config";
import { I18nProvider } from "@/i18n/provider";
import { getServerLocale, getServerMessages } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getServerMessages();
  return { title: t.meta.setup, description: t.meta.setupDescription };
}

export default async function SetupLayout({
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
