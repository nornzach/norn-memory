import {
  Activity,
  ChartLine,
  FolderInput,
  GalleryVerticalEnd,
  KeyRound,
  LockKeyhole,
  Merge,
  Settings,
  Tags,
  Users,
  WebhookIcon,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { Messages } from "@/i18n/messages";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export function getNavGroups(t: Messages): NavGroup[] {
  return [
    {
      label: t.nav.activity,
      items: [
        { title: t.nav.requests, href: "/dashboard/requests", icon: Activity },
        {
          title: t.nav.memories,
          href: "/dashboard/memories",
          icon: GalleryVerticalEnd,
        },
        { title: t.nav.exact, href: "/dashboard/exact", icon: LockKeyhole },
        { title: t.nav.entities, href: "/dashboard/entities", icon: Users },
      ],
    },
    {
      label: t.nav.manage,
      items: [
        { title: t.nav.categories, href: "/dashboard/categories", icon: Tags },
        {
          title: t.nav.consolidation,
          href: "/dashboard/consolidation",
          icon: Merge,
        },
        {
          title: t.nav.webhooks,
          href: "/dashboard/webhooks",
          icon: WebhookIcon,
        },
        {
          title: t.nav.analytics,
          href: "/dashboard/analytics",
          icon: ChartLine,
        },
        { title: t.nav.export, href: "/dashboard/export", icon: FolderInput },
      ],
    },
    {
      label: t.nav.account,
      items: [
        { title: t.nav.apiKeys, href: "/dashboard/api-keys", icon: KeyRound },
        {
          title: t.nav.configuration,
          href: "/dashboard/configuration",
          icon: Wrench,
        },
        { title: t.nav.settings, href: "/dashboard/settings", icon: Settings },
      ],
    },
  ];
}

export function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}
