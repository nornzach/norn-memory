import { Metadata } from "next";
import { getServerLocale, getServerMessages } from "@/i18n/server";
import { DashboardClientLayout } from "./dashboard-client-layout";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerMessages();
  return { title: t.meta.dashboard, description: "Mem0 Dashboard" };
}

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getServerLocale();
  return (
    <DashboardClientLayout locale={locale}>{children}</DashboardClientLayout>
  );
}
