"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import {
  LayoutGrid,
  List,
  Plus,
  RefreshCw,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchInput } from "@/components/ui/search-input";
import { CategoriesDisplay } from "@/components/ui/categories-display";
import DeleteConfirmationModal from "@/components/ui/delete-confirmation-modal";
import { toast } from "@/components/ui/use-toast";
import { Column, DataTable } from "@/components/shared/data-table";
import { TableSkeleton } from "@/components/shared/table-skeleton";
import { Pager } from "@/components/shared/pager";
import { ErrorBanner } from "@/components/shared/error-banner";
import { FilterBar, PageHeader, Panel } from "@/components/shared/page";
import { EmptyState } from "@/components/self-hosted/empty-state";
import {
  SourceCell,
  memorySource,
} from "@/components/self-hosted/source-details";
import { AddMemoryDialog } from "@/components/memories/add-memory-dialog";
import { MemorySheet, getCategories } from "@/components/memories/memory-sheet";
import { getErrorMessage } from "@/lib/error-message";
import { cn } from "@/lib/utils";
import { isExpired } from "@/lib/memory-expiry";
import { api } from "@/utils/api";
import {
  CATEGORY_ENDPOINTS,
  ENTITY_ENDPOINTS,
  MEMORY_ENDPOINTS,
} from "@/utils/api-endpoints";
import { useApiQuery } from "@/hooks/use-api-query";
import { Category, Entity, Memory, Provenance } from "@/types/api";
import { useI18n } from "@/i18n/provider";

const PAGE_SIZE = 20;
// Keep in sync with ALL_MEMORIES_LIMIT in server/main.py.
const MEMORY_FETCH_LIMIT = 1000;
const SEARCH_LIMIT = 50;
const ANY = "__any__";
type SourceFilter = "project" | "device" | "agent" | "cwd";
const SOURCE_FILTERS: SourceFilter[] = ["project", "device", "agent", "cwd"];
const NO_SOURCE_FILTER: Record<SourceFilter, string> = {
  project: ANY,
  device: ANY,
  agent: ANY,
  cwd: ANY,
};

/** A folder matches itself and every folder under it, as the server's cwd filter does. */
function sourceMatches(
  field: SourceFilter,
  value: string | null | undefined,
  wanted: string,
) {
  if (wanted === ANY) return true;
  if (!value) return false;
  if (field !== "cwd") return value === wanted;
  return value === wanted || value.startsWith(`${wanted.replace(/\/+$/, "")}/`);
}

type ScoredMemory = Memory & { score?: number };
type ViewMode = "cards" | "list";
const VIEW_KEY = "norn_m.memories.view";

/** "user:alice" / "agent:bot" ↔ {user_id: "alice"} / {agent_id: "bot"}. */
function ownerParams(owner: string): Record<string, string> {
  if (owner === ANY) return {};
  const [type, ...rest] = owner.split(":");
  const id = rest.join(":");
  return type === "agent" ? { agent_id: id } : { user_id: id };
}

function urlParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

// Entities link here with ?user_id= or ?agent_id=, categories with ?category=.
function ownerFromUrl(): string {
  if (typeof window === "undefined") return ANY;
  const params = new URLSearchParams(window.location.search);
  if (params.get("user_id")) return `user:${params.get("user_id")}`;
  if (params.get("agent_id")) return `agent:${params.get("agent_id")}`;
  return ANY;
}

export default function MemoriesPage() {
  const { t, dateLocale } = useI18n();
  const [view, setView] = useState<ViewMode>("cards");

  useEffect(() => {
    try {
      if (localStorage.getItem(VIEW_KEY) === "list") setView("list");
    } catch {
      // Storage blocked: stay on cards.
    }
  }, []);

  const changeView = (next: ViewMode) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Storage blocked: the choice lasts for this visit.
    }
  };
  const [owner, setOwner] = useState(ownerFromUrl);
  const [category, setCategory] = useState(() => urlParam("category") ?? ANY);
  const [sourceFilter, setSourceFilter] =
    useState<Record<SourceFilter, string>>(NO_SOURCE_FILTER);
  const [showExpired, setShowExpired] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [query, setQuery] = useState("");
  const [semantic, setSemantic] = useState<{
    query: string;
    results: ScoredMemory[];
  } | null>(null);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Memory | null>(null);
  const [toDelete, setToDelete] = useState<Memory | null>(null);
  const [adding, setAdding] = useState(false);
  const [page, setPage] = useState(0);

  const {
    data: memories = [],
    isLoading,
    error,
    refetch,
  } = useApiQuery<Memory[]>(
    async () => {
      const params: Record<string, string | number> = {
        top_k: MEMORY_FETCH_LIMIT,
        ...ownerParams(owner),
      };
      if (category !== ANY) params.category = category;
      if (showExpired) params.show_expired = "true";
      const res = await api.get(MEMORY_ENDPOINTS.BASE, { params });
      const raw = res.data?.results ?? res.data ?? [];
      return Array.isArray(raw) ? raw : [];
    },
    { errorToast: t.memories.loadFailed, initialData: [] },
  );

  const { data: categories = [] } = useApiQuery<Category[]>(
    async () => (await api.get<Category[]>(CATEGORY_ENDPOINTS.BASE)).data ?? [],
    { initialData: [] },
  );
  const { data: entities = [] } = useApiQuery<Entity[]>(
    async () => (await api.get<Entity[]>(ENTITY_ENDPOINTS.BASE)).data ?? [],
    { initialData: [] },
  );
  const users = entities.filter((e) => e.type === "user").map((e) => e.id);
  const agents = entities.filter((e) => e.type === "agent").map((e) => e.id);
  // Keep the owner from the URL selectable even before entities load.
  const [ownerType, ownerId] = owner === ANY ? ["", ""] : owner.split(/:(.*)/);
  if (ownerType === "user" && ownerId && !users.includes(ownerId))
    users.unshift(ownerId);
  if (ownerType === "agent" && ownerId && !agents.includes(ownerId))
    agents.unshift(ownerId);

  // useApiQuery fetches on mount; refetch when the server-side filters change after that.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    setPage(0);
    setSemantic(null);
    void refetch();
  }, [owner, category, showExpired, refetch]);

  const runSemanticSearch = async () => {
    const q = query.trim();
    if (owner === ANY || !q) return;
    setSearching(true);
    try {
      const res = await api.post(MEMORY_ENDPOINTS.SEARCH, {
        query: q,
        filters: ownerParams(owner),
        top_k: SEARCH_LIMIT,
        ...(showExpired && { show_expired: true }),
      });
      const raw = res.data?.results ?? res.data ?? [];
      setSemantic({ query: q, results: Array.isArray(raw) ? raw : [] });
      setPage(0);
    } catch (err) {
      toast({
        title: t.memories.searchFailed,
        description: getErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setSearching(false);
    }
  };

  const base: ScoredMemory[] = semantic ? semantic.results : memories;

  const sources = useMemo(
    () => new Map(base.map((m) => [m.id, memorySource(m)])),
    [base],
  );
  const sourceOptions = useMemo(() => {
    const options = {} as Record<SourceFilter, string[]>;
    for (const field of SOURCE_FILTERS) {
      const values = new Set<string>();
      memories.forEach((m) => {
        const value = memorySource(m)[field];
        if (value) values.add(value);
      });
      options[field] = Array.from(values).sort();
    }
    return options;
  }, [memories]);

  const needle = semantic ? "" : query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      base.filter((m) => {
        const source: Provenance = sources.get(m.id) ?? {};
        if (
          !SOURCE_FILTERS.every((f) =>
            sourceMatches(f, source[f], sourceFilter[f]),
          )
        )
          return false;
        if (
          category !== ANY &&
          semantic &&
          !getCategories(m).includes(category)
        )
          return false;
        return !needle || m.memory?.toLowerCase().includes(needle);
      }),
    [base, sources, sourceFilter, needle, category, semantic],
  );

  const activeSourceFilters =
    SOURCE_FILTERS.filter((f) => sourceFilter[f] !== ANY).length +
    (showExpired ? 1 : 0);
  const anyFilter =
    owner !== ANY ||
    category !== ANY ||
    activeSourceFilters > 0 ||
    Boolean(query.trim());

  const clearFilters = () => {
    setOwner(ANY);
    setCategory(ANY);
    setSourceFilter(NO_SOURCE_FILTER);
    setShowExpired(false);
    setQuery("");
    setSemantic(null);
    setPage(0);
  };

  const pageRows = visible.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const handleDelete = async () => {
    if (!toDelete) return;
    try {
      await api.delete(MEMORY_ENDPOINTS.BY_ID(toDelete.id));
      toast({ title: t.memories.deleted, variant: "success" });
      if (selected?.id === toDelete.id) setSelected(null);
      if (semantic) {
        setSemantic({
          ...semantic,
          results: semantic.results.filter((m) => m.id !== toDelete.id),
        });
      }
      setToDelete(null);
      void refetch();
    } catch (err) {
      toast({
        title: t.memories.deleteFailed,
        description: getErrorMessage(err),
        variant: "destructive",
      });
    }
  };

  const date = (value?: string) =>
    value
      ? format(new Date(value), t.common.dateFormat, { locale: dateLocale })
      : t.common.none;

  const columns: Column<ScoredMemory>[] = [
    {
      key: "memory",
      label: t.memories.columns.content,
      wrap: true,
      render: (value, row) => (
        <span className="flex min-w-[240px] max-w-[560px] items-start gap-2">
          <span className="line-clamp-2 text-sm leading-6 text-ink">
            {String(value ?? "")}
          </span>
          {isExpired(row) && (
            <Badge variant="warning" className="mt-0.5 shrink-0">
              {t.memories.expired}
            </Badge>
          )}
        </span>
      ),
    },
    ...(semantic
      ? [
          {
            key: "score" as const,
            label: t.memories.score,
            align: "right" as const,
            className: "tabular text-ink-2",
            render: (value: unknown) =>
              typeof value === "number" ? value.toFixed(2) : t.common.none,
          },
        ]
      : []),
    {
      key: "categories",
      label: t.memories.columns.categories,
      hideBelow: "lg",
      render: (_, row) => <CategoriesDisplay categories={getCategories(row)} />,
    },
    {
      key: "user_id",
      label: t.memories.columns.user,
      className: "max-w-[160px] truncate text-ink-2",
      render: (_, row) => row.user_id || row.agent_id || t.common.none,
    },
    {
      key: "metadata",
      label: t.source.column,
      hideBelow: "xl",
      className: "max-w-[180px]",
      render: (_, row) => <SourceCell source={sources.get(row.id) ?? {}} />,
    },
    {
      key: "created_at",
      label: t.memories.columns.created,
      className: "text-ink-2",
      render: (value) => date(value as string | undefined),
    },
  ];

  const allLabels: Record<SourceFilter, string> = {
    project: t.source.allProjects,
    device: t.source.allDevices,
    agent: t.source.allAgents,
    cwd: t.source.allFolders,
  };
  const fieldLabels: Record<SourceFilter, string> = {
    project: t.source.project,
    device: t.source.device,
    agent: t.source.agent,
    cwd: t.source.folder,
  };

  const curl = `curl -X POST ${process.env.NEXT_PUBLIC_API_URL || ""}/memories \\
  -H "X-API-Key: <your-key>" \\
  -H "Content-Type: application/json" \\
  -d '{"messages": [{"role": "user", "content": "I like hiking"}], "user_id": "alice"}'`;

  return (
    <>
      <PageHeader
        title={t.memories.title}
        meta={
          !isLoading && !semantic && memories.length > 0
            ? t.memories.count(visible.length, memories.length)
            : undefined
        }
        description={t.memories.subtitle}
        actions={
          <>
            <Button
              variant="outline"
              size="icon"
              onClick={() => void refetch()}
              disabled={isLoading}
              aria-label={t.common.refresh}
              title={t.common.refresh}
            >
              <RefreshCw className={isLoading ? "animate-spin" : undefined} />
            </Button>
            <Button onClick={() => setAdding(true)}>
              <Plus aria-hidden />
              {t.memories.add}
            </Button>
          </>
        }
      />

      {error && !isLoading && (
        <ErrorBanner message={error} onRetry={() => void refetch()} />
      )}

      <Panel>
        <FilterBar>
          <form
            className="xs:col-span-2 md:min-w-[240px] md:flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              void runSemanticSearch();
            }}
            role="search"
          >
            <SearchInput
              value={query}
              onValueChange={(value) => {
                setQuery(value);
                setPage(0);
                if (!value) setSemantic(null);
              }}
              placeholder={
                owner === ANY
                  ? t.memories.searchPlaceholder
                  : t.memories.searchSemanticPlaceholder
              }
              aria-label={t.common.search}
              enterKeyHint="search"
              disabled={searching}
            />
          </form>
          <Select value={owner} onValueChange={setOwner}>
            <SelectTrigger
              className="md:w-48"
              aria-label={t.memories.userFilterLabel}
            >
              <SelectValue placeholder={t.memories.allUsers} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{t.memories.allUsers}</SelectItem>
              {users.length > 0 && (
                <SelectGroup>
                  <SelectLabel>{t.entities.types.user}</SelectLabel>
                  {users.map((id) => (
                    <SelectItem key={`user:${id}`} value={`user:${id}`}>
                      {id}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              {agents.length > 0 && (
                <SelectGroup>
                  <SelectLabel>{t.entities.types.agent}</SelectLabel>
                  {agents.map((id) => (
                    <SelectItem key={`agent:${id}`} value={`agent:${id}`}>
                      {id}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
            </SelectContent>
          </Select>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger
              className="md:w-44"
              aria-label={t.memories.categoryFilter}
            >
              <SelectValue placeholder={t.common.allCategories} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{t.common.allCategories}</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.name}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            onClick={() => setShowMore((v) => !v)}
            aria-expanded={showMore}
            className={cn(
              "shrink-0",
              activeSourceFilters > 0 && "border-brand text-brand-text",
            )}
          >
            <SlidersHorizontal aria-hidden />
            {t.memories.moreFilters}
            {activeSourceFilters > 0 && (
              <span className="tabular grid size-5 place-items-center rounded-full bg-brand-soft text-xs">
                {activeSourceFilters}
              </span>
            )}
          </Button>
          <div
            role="group"
            aria-label={t.memories.view}
            className="hidden shrink-0 items-center gap-0.5 rounded-lg bg-subtle p-0.5 md:flex"
          >
            {(
              [
                ["cards", LayoutGrid, t.memories.viewCards],
                ["list", List, t.memories.viewList],
              ] as const
            ).map(([mode, Icon, label]) => (
              <button
                key={mode}
                type="button"
                aria-pressed={view === mode}
                aria-label={label}
                title={label}
                onClick={() => changeView(mode)}
                className={cn(
                  "grid size-8 place-items-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--focus)]",
                  view === mode
                    ? "bg-panel text-ink shadow-elev-1"
                    : "text-ink-3 hover:text-ink",
                )}
              >
                <Icon className="size-4" aria-hidden />
              </button>
            ))}
          </div>
        </FilterBar>

        {showMore && (
          <div className="grid grid-cols-1 items-center gap-2 border-b border-line bg-subtle/40 px-5 py-3 xs:grid-cols-2 sm:px-6 xl:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
            {SOURCE_FILTERS.map((field) => (
              <Select
                key={field}
                value={sourceFilter[field]}
                onValueChange={(value) => {
                  setSourceFilter((current) => ({
                    ...current,
                    [field]: value,
                  }));
                  setPage(0);
                }}
              >
                <SelectTrigger
                  aria-label={fieldLabels[field]}
                  title={
                    sourceFilter[field] !== ANY
                      ? sourceFilter[field]
                      : undefined
                  }
                >
                  <SelectValue placeholder={allLabels[field]} />
                </SelectTrigger>
                <SelectContent className="max-w-[min(90vw,480px)]">
                  <SelectItem value={ANY}>{allLabels[field]}</SelectItem>
                  {sourceOptions[field].map((value) => (
                    <SelectItem key={value} value={value} title={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ))}
            <label className="flex h-9 cursor-pointer items-center gap-2 whitespace-nowrap px-1 text-sm text-ink-2 xs:col-span-2 xl:col-span-1">
              <Switch checked={showExpired} onCheckedChange={setShowExpired} />
              {t.memories.showExpired}
            </label>
          </div>
        )}

        {(semantic || (owner === ANY && query.trim())) && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-2 text-xs text-ink-3 sm:px-6">
            <span>
              {semantic
                ? t.memories.semanticResults(visible.length, semantic.query)
                : t.memories.searchHint}
            </span>
            {semantic && (
              <Button
                variant="link"
                size="xs"
                onClick={() => {
                  setSemantic(null);
                  setQuery("");
                }}
              >
                {t.common.clearFilters}
              </Button>
            )}
          </div>
        )}

        {isLoading || searching ? (
          <TableSkeleton rows={6} columns={5} />
        ) : memories.length === 0 && !anyFilter ? (
          <EmptyState
            title={t.memories.emptyTitle}
            description={t.memories.emptyDescription}
          >
            <Button onClick={() => setAdding(true)}>
              <Plus aria-hidden />
              {t.memories.add}
            </Button>
            <div className="mt-2 w-full max-w-xl text-left">
              <pre className="scrollbar-thin overflow-x-auto rounded-lg border border-line bg-sunken p-3 font-mono text-xs leading-5 text-ink-2">
                {curl}
              </pre>
              <a
                href="https://github.com/nornzach/norn-memory/blob/main/docs/api.md#memories"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block text-xs font-medium text-brand-text underline-offset-4 hover:underline"
              >
                {t.memories.restReference}
              </a>
            </div>
          </EmptyState>
        ) : visible.length === 0 ? (
          <EmptyState
            title={
              category !== ANY && memories.length === 0
                ? t.memories.emptyCategoryTitle
                : t.memories.emptyFilterTitle
            }
            description={
              category !== ANY && memories.length === 0
                ? t.memories.emptyCategoryDescription
                : activeSourceFilters > 0
                  ? t.memories.emptyFilterDescription
                  : undefined
            }
          >
            <Button variant="outline" size="sm" onClick={clearFilters}>
              {t.common.clearFilters}
            </Button>
          </EmptyState>
        ) : (
          <>
            {view === "cards" ? (
              <ul className="grid grid-cols-1 gap-3 bg-sunken/50 p-4 sm:grid-cols-2 sm:gap-4 sm:p-6 xl:grid-cols-3">
                {pageRows.map((row) => {
                  const active = selected?.id === row.id;
                  return (
                    <li key={row.id} className="min-w-0">
                      <button
                        type="button"
                        onClick={() => setSelected(row)}
                        aria-label={t.memories.openLabel(
                          row.memory?.slice(0, 60) ?? row.id,
                        )}
                        className={cn(
                          "group flex h-full w-full flex-col gap-3 rounded-xl border bg-panel p-4 text-left transition-[border-color,box-shadow,transform] hover:-translate-y-px hover:border-line-strong hover:shadow-elev-2 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--focus)] sm:p-5",
                          active ? "border-brand" : "border-line",
                        )}
                      >
                        <p className="line-clamp-4 flex-1 text-[15px] leading-6 text-ink">
                          {row.memory}
                        </p>
                        <CategoriesDisplay
                          categories={getCategories(row)}
                          max={3}
                        />
                        <p className="flex items-center gap-1.5 truncate border-t border-line pt-3 text-xs text-ink-3">
                          <span className="truncate font-medium text-ink-2">
                            {row.user_id || row.agent_id || t.common.none}
                          </span>
                          <span aria-hidden>·</span>
                          <span className="shrink-0">
                            {date(row.created_at)}
                          </span>
                          {isExpired(row) && (
                            <Badge variant="warning" className="shrink-0">
                              {t.memories.expired}
                            </Badge>
                          )}
                          {typeof row.score === "number" && (
                            <span className="tabular ml-auto shrink-0 rounded-full bg-brand-soft px-2 py-0.5 font-medium text-brand-text">
                              {row.score.toFixed(2)}
                            </span>
                          )}
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <DataTable
                data={pageRows}
                columns={columns}
                caption={t.memories.title}
                getRowKey={(row) => row.id}
                onRowClick={(row) => setSelected(row)}
                getRowLabel={(row) =>
                  t.memories.openLabel(row.memory?.slice(0, 60) ?? row.id)
                }
                getRowClassName={(row) =>
                  selected?.id === row.id ? "bg-brand-soft/60" : undefined
                }
                renderMobileCard={(row) => (
                  <div className="flex flex-col gap-2">
                    <p className="line-clamp-3 text-sm leading-6 text-ink">
                      {row.memory}
                    </p>
                    {isExpired(row) && (
                      <Badge variant="warning" className="self-start">
                        {t.memories.expired}
                      </Badge>
                    )}
                    <CategoriesDisplay categories={getCategories(row)} />
                    <p className="truncate text-xs text-ink-3">
                      {[
                        row.user_id || row.agent_id,
                        date(row.created_at),
                        typeof row.score === "number"
                          ? `${t.memories.score} ${row.score.toFixed(2)}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                )}
              />
            )}
            <Pager
              page={page}
              pageSize={PAGE_SIZE}
              shown={pageRows.length}
              total={visible.length}
              onPageChange={setPage}
            />
          </>
        )}
      </Panel>

      <AddMemoryDialog
        open={adding}
        onOpenChange={setAdding}
        defaultUserId={ownerType === "user" ? ownerId : ""}
        defaultAgentId={ownerType === "agent" ? ownerId : ""}
        knownUsers={users}
        onAdded={() => {
          setSemantic(null);
          void refetch();
        }}
      />

      <MemorySheet
        memory={selected}
        onClose={() => setSelected(null)}
        onDelete={setToDelete}
        onUpdated={(updated) => {
          setSelected(updated);
          if (semantic) {
            setSemantic({
              ...semantic,
              results: semantic.results.map((m) =>
                m.id === updated.id
                  ? {
                      ...m,
                      memory: updated.memory,
                      expiration_date: updated.expiration_date,
                    }
                  : m,
              ),
            });
          }
          void refetch();
        }}
      />

      <DeleteConfirmationModal
        isOpen={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={handleDelete}
        title={t.memories.deleteTitle}
        description={t.memories.deleteDescription}
        itemName={toDelete?.id ?? ""}
        confirmButtonText={t.common.delete}
      />
    </>
  );
}
