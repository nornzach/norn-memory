"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/shared/data-table";
import { TableSkeleton } from "@/components/shared/table-skeleton";
import { EmptyState } from "@/components/self-hosted/empty-state";
import DeleteConfirmationModal from "@/components/ui/delete-confirmation-modal";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CategoriesDisplay } from "@/components/ui/categories-display";
import {
  SourceCell,
  SourceDetails,
  memorySource,
} from "@/components/self-hosted/source-details";
import { toast } from "@/components/ui/use-toast";
import { getErrorMessage } from "@/lib/error-message";
import { api } from "@/utils/api";
import { CATEGORY_ENDPOINTS, MEMORY_ENDPOINTS } from "@/utils/api-endpoints";
import { useApiQuery } from "@/hooks/use-api-query";
import { Category, Memory, Provenance } from "@/types/api";
import { useI18n } from "@/i18n/provider";

const PAGE_SIZE = 20;
// Keep in sync with ALL_MEMORIES_LIMIT in server/main.py.
const MEMORY_FETCH_LIMIT = 1000;
const ALL_CATEGORIES = "__all__";
const ANY = "__any__";
type SourceFilter = "project" | "device" | "agent";
const SOURCE_FILTERS: SourceFilter[] = ["project", "device", "agent"];

// The admin listing returns categories at the top level; scoped (per-user) listings
// keep them inside metadata.
const getCategories = (memory: Memory): string[] => {
  if (memory.categories?.length) return memory.categories;
  const fromMetadata = memory.metadata?.categories;
  return Array.isArray(fromMetadata) ? (fromMetadata as string[]) : [];
};

export default function MemoriesPage() {
  const [userId, setUserId] = useState("");
  const [category, setCategory] = useState(ALL_CATEGORIES);
  // Project, device and agent filter the loaded page client-side; the options come from it too.
  const [sourceFilter, setSourceFilter] = useState<
    Record<SourceFilter, string>
  >({ project: ANY, device: ANY, agent: ANY });
  const [selectedMemory, setSelectedMemory] = useState<Memory | null>(null);
  const [memoryToDelete, setMemoryToDelete] = useState<Memory | null>(null);
  const [page, setPage] = useState(0);
  const { t, dateLocale } = useI18n();
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";

  const {
    data: memories = [],
    isLoading,
    refetch,
  } = useApiQuery<Memory[]>(
    async () => {
      const params: Record<string, string | number> = {
        top_k: MEMORY_FETCH_LIMIT,
      };
      if (userId.trim()) params.user_id = userId.trim();
      if (category !== ALL_CATEGORIES) params.category = category;
      const res = await api.get(MEMORY_ENDPOINTS.BASE, { params });
      const raw = res.data?.results ?? res.data ?? [];
      return Array.isArray(raw) ? raw : [];
    },
    { errorToast: t.memories.loadFailed, initialData: [] },
  );

  const { data: categories = [] } = useApiQuery<Category[]>(
    async () => {
      const res = await api.get<Category[]>(CATEGORY_ENDPOINTS.BASE);
      return res.data ?? [];
    },
    { initialData: [] },
  );

  // useApiQuery fetches on mount; refetch only when the category filter changes after that.
  const isFirstCategory = useRef(true);
  useEffect(() => {
    if (isFirstCategory.current) {
      isFirstCategory.current = false;
      return;
    }
    setPage(0);
    void refetch();
  }, [category, refetch]);

  const sources = useMemo(
    () => new Map(memories.map((m) => [m.id, memorySource(m)])),
    [memories],
  );
  const sourceOptions = useMemo(() => {
    const options = {} as Record<SourceFilter, string[]>;
    for (const field of SOURCE_FILTERS) {
      const values = new Set<string>();
      sources.forEach((source) => {
        if (source[field]) values.add(source[field] as string);
      });
      options[field] = Array.from(values).sort();
    }
    return options;
  }, [sources]);
  const sourceFiltered = SOURCE_FILTERS.some((f) => sourceFilter[f] !== ANY);
  const visibleMemories = useMemo(
    () =>
      memories.filter((m) => {
        const source: Provenance = sources.get(m.id) ?? {};
        return SOURCE_FILTERS.every(
          (f) => sourceFilter[f] === ANY || source[f] === sourceFilter[f],
        );
      }),
    [memories, sources, sourceFilter],
  );

  const totalPages = Math.ceil(visibleMemories.length / PAGE_SIZE);
  const paginatedMemories = visibleMemories.slice(
    page * PAGE_SIZE,
    (page + 1) * PAGE_SIZE,
  );
  const allLabels: Record<SourceFilter, string> = {
    project: t.source.allProjects,
    device: t.source.allDevices,
    agent: t.source.allAgents,
  };

  const handleDelete = async () => {
    if (!memoryToDelete) return;
    try {
      await api.delete(MEMORY_ENDPOINTS.BY_ID(memoryToDelete.id));
      toast({ title: t.memories.deleted, variant: "success" });
      if (selectedMemory?.id === memoryToDelete.id) setSelectedMemory(null);
      setMemoryToDelete(null);
      void refetch();
    } catch (error) {
      toast({
        title: t.memories.deleteFailed,
        description: getErrorMessage(error),
        variant: "destructive",
      });
    }
  };

  const columns = [
    {
      key: "memory" as keyof Memory,
      label: t.memories.columns.content,
      width: 400,
      render: (value: string) => (
        <span className="line-clamp-2 text-sm">{value}</span>
      ),
    },
    {
      key: "categories" as keyof Memory,
      label: t.memories.columns.categories,
      width: 120,
      render: (_: unknown, row: Memory) => (
        <CategoriesDisplay categories={getCategories(row)} />
      ),
    },
    {
      key: "user_id" as keyof Memory,
      label: t.memories.columns.user,
      width: 100,
    },
    {
      key: "metadata" as keyof Memory,
      label: t.source.column,
      width: 140,
      render: (_: unknown, row: Memory) => (
        <SourceCell source={sources.get(row.id) ?? {}} />
      ),
    },
    {
      key: "created_at" as keyof Memory,
      label: t.memories.columns.created,
      width: 120,
      render: (value: string) =>
        value
          ? format(new Date(value), t.common.dateFormat, {
              locale: dateLocale,
            })
          : "--",
    },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold font-fustat">{t.memories.title}</h1>

      <div className="flex flex-wrap gap-3">
        <Input
          placeholder={t.memories.userFilter}
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              setPage(0);
              refetch();
            }
          }}
          className="w-full sm:w-64"
        />
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger
            className="w-full sm:w-48"
            aria-label={t.memories.categoryFilter}
          >
            <SelectValue placeholder={t.common.allCategories} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_CATEGORIES}>
              {t.common.allCategories}
            </SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.name}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {SOURCE_FILTERS.map((field) => (
          <Select
            key={field}
            value={sourceFilter[field]}
            onValueChange={(value) => {
              setSourceFilter((current) => ({ ...current, [field]: value }));
              setPage(0);
            }}
          >
            <SelectTrigger
              className="w-full sm:w-40"
              aria-label={t.source[field]}
            >
              <SelectValue placeholder={allLabels[field]} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{allLabels[field]}</SelectItem>
              {sourceOptions[field].map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ))}
      </div>

      {isLoading ? (
        <TableSkeleton rows={5} columns={4} />
      ) : memories.length === 0 && category !== ALL_CATEGORIES ? (
        <EmptyState
          title={t.memories.emptyCategoryTitle}
          description={t.memories.emptyCategoryDescription}
        />
      ) : visibleMemories.length === 0 && sourceFiltered ? (
        <EmptyState
          title={t.memories.emptyFilterTitle}
          description={t.memories.emptyFilterDescription}
        />
      ) : memories.length === 0 ? (
        <EmptyState
          title={t.memories.emptyTitle}
          description={t.memories.emptyDescription}
        >
          <pre className="text-xs text-left bg-surface-default-secondary p-3 rounded font-mono overflow-x-auto mt-3 max-w-lg">
            {`curl -X POST ${apiUrl}/memories \\
  -H "X-API-Key: <your-key>" \\
  -H "Content-Type: application/json" \\
  -d '{"messages": [{"role": "user", "content": "I like hiking"}], "user_id": "alice"}'`}
          </pre>
          <a
            href="https://github.com/nornzach/norn-memory/blob/main/docs/api.md#memories"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-onSurface-default-tertiary underline underline-offset-4 hover:text-onSurface-default-primary mt-2"
          >
            {t.memories.restReference}
          </a>
        </EmptyState>
      ) : (
        <>
          <Card className="border-memBorder-primary overflow-hidden">
            <DataTable
              data={paginatedMemories}
              columns={columns}
              getRowKey={(row) => row.id}
              onRowClick={(row) => setSelectedMemory(row)}
              getRowClassName={(row) =>
                selectedMemory?.id === row.id
                  ? "bg-surface-default-tertiary"
                  : undefined
              }
            />
          </Card>
          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-onSurface-default-tertiary">
              <span>
                {t.common.range(
                  page * PAGE_SIZE + 1,
                  Math.min((page + 1) * PAGE_SIZE, visibleMemories.length),
                  visibleMemories.length,
                )}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                >
                  {t.common.previous}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage((p) => p + 1)}
                >
                  {t.common.next}
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <Sheet
        open={!!selectedMemory}
        onOpenChange={(open) => {
          if (!open) setSelectedMemory(null);
        }}
      >
        <SheetContent className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{t.memories.detailTitle}</SheetTitle>
            <SheetDescription className="sr-only">
              {t.memories.detailDescription}
            </SheetDescription>
          </SheetHeader>
          {selectedMemory && (
            <div className="mt-6 space-y-4">
              <div className="space-y-1">
                <Label className="text-xs text-onSurface-default-tertiary">
                  {t.memories.columns.content}
                </Label>
                <p className="text-sm">{selectedMemory.memory}</p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-onSurface-default-tertiary">
                  {t.memories.columns.categories}
                </Label>
                {getCategories(selectedMemory).length ? (
                  <CategoriesDisplay
                    categories={getCategories(selectedMemory)}
                    showAllCategories
                  />
                ) : (
                  <p className="text-sm text-onSurface-default-tertiary">
                    {t.memories.noCategories}
                  </p>
                )}
              </div>
              <SourceDetails source={memorySource(selectedMemory)} />
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs text-onSurface-default-tertiary">
                    {t.memories.id}
                  </Label>
                  <p className="text-xs font-mono break-all">
                    {selectedMemory.id}
                  </p>
                </div>
                {selectedMemory.user_id && (
                  <div className="space-y-1">
                    <Label className="text-xs text-onSurface-default-tertiary">
                      {t.memories.columns.user}
                    </Label>
                    <p className="text-sm">{selectedMemory.user_id}</p>
                  </div>
                )}
                {selectedMemory.agent_id && (
                  <div className="space-y-1">
                    <Label className="text-xs text-onSurface-default-tertiary">
                      {t.common.agentId}
                    </Label>
                    <p className="text-sm">{selectedMemory.agent_id}</p>
                  </div>
                )}
                {selectedMemory.created_at && (
                  <div className="space-y-1">
                    <Label className="text-xs text-onSurface-default-tertiary">
                      {t.memories.columns.created}
                    </Label>
                    <p className="text-sm">
                      {format(
                        new Date(selectedMemory.created_at),
                        t.common.dateTimeFormat,
                        { locale: dateLocale },
                      )}
                    </p>
                  </div>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="text-onSurface-danger-primary"
                onClick={() => setMemoryToDelete(selectedMemory)}
              >
                <Trash2 className="size-3.5 mr-1" />
                {t.memories.deleteMemory}
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <DeleteConfirmationModal
        isOpen={!!memoryToDelete}
        onClose={() => setMemoryToDelete(null)}
        onConfirm={handleDelete}
        title={t.memories.deleteTitle}
        description={t.memories.deleteDescription}
        itemName={memoryToDelete?.id ?? ""}
        confirmButtonText={t.common.delete}
      />
    </div>
  );
}
