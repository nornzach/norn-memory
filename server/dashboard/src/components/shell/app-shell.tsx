"use client";

import { ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDispatch, useSelector } from "react-redux";
import { useTheme } from "next-themes";
import {
  BookOpen,
  Check,
  ChevronsUpDown,
  Languages,
  LogOut,
  Menu,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sun,
  UserRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { RootState } from "@/store/store";
import { toggleSidebar } from "@/store/reducers/layoutReducer";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/i18n/provider";
import { LOCALES, LOCALE_LABELS } from "@/i18n/config";
import { NornMark } from "@/components/misc/norn-mark";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getNavGroups, isActivePath } from "./nav-items";

const DOCS_URL = "https://github.com/nornzach/norn-memory#readme";

function instanceName() {
  return process.env.NEXT_PUBLIC_INSTANCE_NAME || "Norn-M";
}

function Brand({ collapsed }: { collapsed?: boolean }) {
  return (
    <Link
      href="/dashboard/requests"
      className="flex min-w-0 items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--focus)]"
    >
      <NornMark size={28} />
      {!collapsed && (
        <span className="truncate font-serif text-[19px] text-ink">
          {instanceName()}
        </span>
      )}
    </Link>
  );
}

function SidebarNav({
  collapsed,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const { t } = useI18n();

  return (
    <nav aria-label={t.nav.mainNavigation} className="flex flex-col gap-5">
      {getNavGroups(t).map((group, index) => (
        <div key={group.label} className="flex flex-col gap-0.5">
          {collapsed ? (
            index > 0 && <div className="mx-auto mb-2 h-px w-6 bg-line" />
          ) : (
            <p className="mb-1 px-2.5 text-xs font-medium text-ink-3">
              {group.label}
            </p>
          )}
          {group.items.map((item) => {
            const active = isActivePath(pathname, item.href);
            const link = (
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group relative flex h-9 items-center gap-2.5 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--focus)]",
                  collapsed ? "mx-auto w-9 justify-center" : "px-2.5",
                  active
                    ? "bg-panel text-ink shadow-elev-1 ring-1 ring-line"
                    : "text-ink-2 hover:bg-subtle hover:text-ink",
                )}
              >
                <item.icon
                  className={cn(
                    "size-4 shrink-0",
                    active ? "text-brand" : "text-ink-3 group-hover:text-ink-2",
                  )}
                  aria-hidden
                />
                {collapsed ? (
                  <span className="sr-only">{item.title}</span>
                ) : (
                  <span className="truncate">{item.title}</span>
                )}
              </Link>
            );
            return collapsed ? (
              <Tooltip key={item.href}>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side="right">{item.title}</TooltipContent>
              </Tooltip>
            ) : (
              <div key={item.href}>{link}</div>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/** Account, theme, language, docs and log out, in one menu. */
function UserMenu({
  collapsed,
  side = "top",
}: {
  collapsed?: boolean;
  side?: "top" | "bottom";
}) {
  const { user, logout } = useAuth();
  const { t, locale, setLocale } = useI18n();
  const { theme, setTheme } = useTheme();
  const initial = user?.name?.charAt(0).toUpperCase() || "?";

  const themes = [
    { value: "light", label: t.nav.themeLight, icon: Sun },
    { value: "dark", label: t.nav.themeDark, icon: Moon },
    { value: "system", label: t.nav.themeSystem, icon: Monitor },
  ];

  const avatar = (
    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-soft text-[13px] font-semibold text-brand-text">
      {initial}
    </span>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t.nav.accountMenu}
          className={cn(
            "flex min-w-0 items-center gap-2.5 rounded-lg text-left transition-colors hover:bg-subtle focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--focus)] data-[state=open]:bg-subtle",
            collapsed ? "mx-auto size-10 justify-center" : "w-full p-2",
          )}
        >
          {avatar}
          {!collapsed && (
            <>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium text-ink">
                  {user?.name}
                </span>
                <span className="truncate text-xs text-ink-3">
                  {user?.email}
                </span>
              </span>
              <ChevronsUpDown className="size-4 shrink-0 text-ink-3" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={collapsed ? "start" : "end"}
        side={collapsed ? "right" : side}
        className="w-60"
      >
        <DropdownMenuItem asChild className="gap-2.5 py-2">
          <Link href="/dashboard/settings#profile">
            {avatar}
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium text-ink">
                {user?.name}
              </span>
              <span className="truncate text-xs text-ink-3">{user?.email}</span>
            </span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/dashboard/settings#profile">
            <UserRound />
            {t.nav.editProfile}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/dashboard/settings">
            <Settings />
            {t.nav.settings}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-2 [&_svg]:size-4 [&_svg]:text-ink-3">
            <Sun />
            {t.nav.theme}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-36">
            {themes.map((option) => (
              <DropdownMenuItem
                key={option.value}
                onSelect={() => setTheme(option.value)}
              >
                <option.icon />
                <span className="flex-1">{option.label}</span>
                {theme === option.value && (
                  <Check className="!text-brand" aria-hidden />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-2 [&_svg]:size-4 [&_svg]:text-ink-3">
            <Languages />
            {t.common.language}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-36">
            {LOCALES.map((option) => (
              <DropdownMenuItem
                key={option}
                onSelect={() => locale !== option && setLocale(option)}
              >
                <span className="flex-1">{LOCALE_LABELS[option]}</span>
                {locale === option && (
                  <Check className="!text-brand" aria-hidden />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem asChild>
          <a href={DOCS_URL} target="_blank" rel="noopener noreferrer">
            <BookOpen />
            {t.nav.documentation}
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={logout}>
          <LogOut />
          {t.nav.logout}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const COLLAPSE_KEY = "norn_m_sidebar_collapsed";

function DesktopSidebar() {
  const dispatch = useDispatch();
  const collapsed = useSelector(
    (state: RootState) => state.layout.isSidebarCollapsed,
  );
  const { t } = useI18n();

  // Restore the last choice once; the store always starts expanded.
  useEffect(() => {
    try {
      if (localStorage.getItem(COLLAPSE_KEY) === "1" && !collapsed) {
        dispatch(toggleSidebar());
      }
    } catch {
      // Storage blocked: keep the default.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = () => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? "0" : "1");
    } catch {
      // Storage blocked: the toggle still works for this visit.
    }
    dispatch(toggleSidebar());
  };

  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const toggleLabel = collapsed ? t.nav.expandSidebar : t.nav.collapseSidebar;

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-line bg-sunken transition-[width] duration-200 ease-out lg:flex",
        collapsed ? "w-16" : "w-60",
      )}
    >
      <div
        className={cn(
          "flex h-16 shrink-0 items-center",
          collapsed ? "justify-center" : "justify-between gap-2 pl-4 pr-2",
        )}
      >
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggle}
                aria-label={toggleLabel}
              >
                <ToggleIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{toggleLabel}</TooltipContent>
          </Tooltip>
        ) : (
          <>
            <Brand />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={toggle}
                  aria-label={toggleLabel}
                >
                  <ToggleIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">{toggleLabel}</TooltipContent>
            </Tooltip>
          </>
        )}
      </div>
      <div
        className={cn(
          "scrollbar-thin min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-4",
          collapsed ? "px-2" : "px-3",
        )}
      >
        <SidebarNav collapsed={collapsed} />
      </div>
      <div
        className={cn(
          "shrink-0 border-t border-line",
          collapsed ? "py-3" : "p-2",
        )}
      >
        <UserMenu collapsed={collapsed} />
      </div>
    </aside>
  );
}

function MobileTopBar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const { t } = useI18n();

  // Close the drawer whenever the route changes.
  useEffect(() => setOpen(false), [pathname]);

  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-canvas/90 px-3 backdrop-blur supports-[backdrop-filter]:bg-canvas/75 sm:px-4 lg:hidden">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setOpen(true)}
          aria-label={t.nav.openMenu}
          aria-expanded={open}
        >
          <Menu className="!size-5" />
        </Button>
        <Brand />
        <div className="ml-auto">
          <UserMenu collapsed side="bottom" />
        </div>
      </header>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="left"
          className="w-[280px] max-w-[85vw] gap-0 p-0"
          aria-describedby={undefined}
        >
          <SheetTitle className="sr-only">{t.nav.mainNavigation}</SheetTitle>
          <SheetDescription className="sr-only">
            {instanceName()}
          </SheetDescription>
          <div className="flex h-14 shrink-0 items-center px-4">
            <Brand />
          </div>
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-2">
            <SidebarNav onNavigate={() => setOpen(false)} />
          </div>
          <div className="shrink-0 border-t border-line p-2">
            <UserMenu />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const collapsed = useSelector(
    (state: RootState) => state.layout.isSidebarCollapsed,
  );
  const { t } = useI18n();

  return (
    <div className="min-h-dvh bg-canvas">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-panel px-3 py-2 text-sm font-medium text-ink shadow-elev-2 focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        {t.nav.skipToContent}
      </a>
      <DesktopSidebar />
      <div
        className={cn(
          "flex min-h-dvh min-w-0 flex-col transition-[padding] duration-200 ease-out",
          collapsed ? "lg:pl-16" : "lg:pl-60",
        )}
      >
        <MobileTopBar />
        <main id="main" className="min-w-0 flex-1">
          <div className="mx-auto w-full max-w-[1240px] px-4 py-6 sm:px-8 sm:py-8 lg:px-12 lg:py-12">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
