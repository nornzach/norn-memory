"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { ArrowUpRight, Bot, Play, RefreshCw, Trash2, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { SearchInput } from "@/components/ui/search-input";
import { Column, DataTable } from "@/components/shared/data-table";
import { TableSkeleton } from "@/components/shared/table-skeleton";
import { ErrorBanner } from "@/components/shared/error-banner";
import { FilterBar, PageHeader, Panel } from "@/components/shared/page";
import { EmptyState } from "@/components/self-hosted/empty-state";
import DeleteConfirmationModal from "@/components/ui/delete-confirmation-modal";
import { toast } from "@/components/ui/use-toast";
import { api } from "@/utils/api";
import { ENTITY_ENDPOINTS } from "@/utils/api-endpoints";
import { getErrorMessage } from "@/lib/error-message";
import { useApiQuery } from "@/hooks/use-api-query";
import { Entity, EntityType } from "@/types/api";
import { useI18n } from "@/i18n/provider";

type TypeFilter = "all" | EntityType;

const TYPE_ICON = { user: User, agent: Bot, run: Play } as const;

// Runs are not a memories-page filter, so only users and agents link there.
function memoriesHref(entity: Entity) {
  if (entity.type === "user")
    return `/dashboard/memories?user_id=${encodeURIComponent(entity.id)}`;
  if (entity.type === "agent")
    return `/dashboard/memories?agent_id=${encodeURIComponent(entity.id)}`;
  return null;
}

export default function EntitiesPage() {
  const [entityToDelete, setEntityToDelete] = useState<Entity | null>(null);
  const [type, setType] = useState<TypeFilter>("all");
  const [query, setQuery] = useState("");
  const { t, dateLocale } = useI18n();

  const {
    data: entities = [],
    isLoading,
    error,
    refetch,
  } = useApiQuery<Entity[]>(
    async () => (await api.get<Entity[]>(ENTITY_ENDPOINTS.BASE)).data ?? [],
    { errorToast: t.entities.loadFailed, initialData: [] },
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entities.filter(
      (e) =>
        (type === "all" || e.type === type) &&
        (!needle || e.id.toLowerCase().includes(needle)),
    );
  }, [entities, type, query]);

  const counts = useMemo(() => {
    const c = { user: 0, agent: 0, run: 0 } as Record<EntityType, number>;
    entities.forEach((e) => (c[e.type] = (c[e.type] ?? 0) + 1));
    return c;
  }, [entities]);

  const handleDelete = async () => {
    if (!entityToDelete) return;
    try {
      await api.delete(
        ENTITY_ENDPOINTS.BY_ID(entityToDelete.type, entityToDelete.id),
      );
      toast({ title: t.entities.deleted, variant: "success" });
      setEntityToDelete(null);
      void refetch();
    } catch (err) {
      toast({
        title: t.entities.deleteFailed,
        description: getErrorMessage(err),
        variant: "destructive",
      });
    }
  };

  const date = (value: string | null) =>
    value
      ? format(new Date(value), t.common.dateFormat, { locale: dateLocale })
      : t.common.none;

  const typeBadge = (value: EntityType) => {
    const Icon = TYPE_ICON[value] ?? User;
    return (
      <Badge variant={value === "user" ? "brand" : "secondary"}>
        <Icon aria-hidden />
        {t.entities.types[value]}
      </Badge>
    );
  };

  const actions = (row: Entity) => {
    const href = memoriesHref(row);
    return (
      <div className="flex items-center justify-end gap-1">
        {href && (
          <Button asChild variant="ghost" size="sm">
            <Link href={href} aria-label={t.entities.viewMemoriesLabel(row.id)}>
              {t.entities.viewMemories}
              <ArrowUpRight aria-hidden />
            </Link>
          </Button>
        )}
        <Button
          variant="destructive-ghost"
          size="icon-sm"
          onClick={() => setEntityToDelete(row)}
          aria-label={t.entities.deleteLabel(row.id)}
          title={t.entities.deleteLabel(row.id)}
        >
          <Trash2 aria-hidden />
        </Button>
      </div>
    );
  };

  const columns: Column<Entity>[] = [
    {
      key: "id",
      label: t.entities.columns.id,
      render: (value) => (
        <span className="font-mono text-[13px] text-ink">{String(value)}</span>
      ),
    },
    {
      key: "type",
      label: t.entities.columns.type,
      render: (value) => typeBadge(value as EntityType),
    },
    {
      key: "total_memories",
      label: t.entities.columns.memories,
      align: "right",
      className: "tabular text-ink-2",
    },
    {
      key: "updated_at",
      label: t.entities.columns.lastActive,
      className: "text-ink-2",
      render: (value) => date(value as string | null),
    },
    {
      key: "created_at",
      label: "",
      align: "right",
      isAction: true,
      render: (_, row) => actions(row),
    },
  ];

  return (
    <>
      <PageHeader
        title={t.entities.title}
        description={t.entities.subtitle}
        actions={
          <Button
            variant="outline"
            onClick={() => void refetch()}
            disabled={isLoading}
          >
            <RefreshCw className={isLoading ? "animate-spin" : undefined} />
            {t.common.refresh}
          </Button>
        }
      />

      {error && !isLoading && (
        <ErrorBanner message={error} onRetry={() => void refetch()} />
      )}

      <Panel>
        <FilterBar>
          <SearchInput
            value={query}
            onValueChange={setQuery}
            placeholder={t.entities.searchPlaceholder}
            aria-label={t.entities.searchPlaceholder}
            containerClassName="md:w-64"
          />
          <Segmented
            label={t.entities.columns.type}
            value={type}
            onChange={setType}
            options={[
              { value: "all", label: `${t.entities.all} ${entities.length}` },
              {
                value: "user",
                label: `${t.entities.types.user} ${counts.user}`,
              },
              {
                value: "agent",
                label: `${t.entities.types.agent} ${counts.agent}`,
              },
              { value: "run", label: `${t.entities.types.run} ${counts.run}` },
            ]}
          />
        </FilterBar>

        {isLoading ? (
          <TableSkeleton rows={5} columns={5} />
        ) : entities.length === 0 ? (
          <EmptyState
            title={t.entities.emptyTitle}
            description={t.entities.emptyDescription}
          />
        ) : visible.length === 0 ? (
          <EmptyState title={t.entities.noMatches}>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setQuery("");
                setType("all");
              }}
            >
              {t.common.clearFilters}
            </Button>
          </EmptyState>
        ) : (
          <DataTable
            data={visible}
            columns={columns}
            caption={t.entities.title}
            getRowKey={(row) => `${row.type}:${row.id}`}
            renderMobileCard={(row) => (
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-[13px] text-ink">
                    {row.id}
                  </p>
                  <div className="mt-1 flex items-center gap-2 text-xs text-ink-3">
                    {typeBadge(row.type)}
                    <span className="tabular">
                      {row.total_memories} {t.entities.columns.memories}
                    </span>
                    <span>· {date(row.updated_at)}</span>
                  </div>
                </div>
                {actions(row)}
              </div>
            )}
          />
        )}
      </Panel>

      <DeleteConfirmationModal
        isOpen={!!entityToDelete}
        onClose={() => setEntityToDelete(null)}
        onConfirm={handleDelete}
        title={t.entities.deleteTitle}
        description={t.entities.deleteDescription}
        itemName={entityToDelete?.id ?? ""}
        confirmButtonText={t.common.delete}
        requireTyping
      />
    </>
  );
}
