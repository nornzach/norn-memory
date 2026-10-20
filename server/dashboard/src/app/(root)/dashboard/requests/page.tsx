"use client";

import { useMemo, useState } from "react";
import { format, formatDistanceToNow, isToday } from "date-fns";
import {
  Activity,
  CheckCircle2,
  KeyRound,
  RefreshCw,
  Timer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Segmented } from "@/components/ui/segmented";
import { SearchInput } from "@/components/ui/search-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getMethodClassName, getStatusClassName } from "@/lib/http-badges";
import { Column, DataTable } from "@/components/shared/data-table";
import { TableSkeleton } from "@/components/shared/table-skeleton";
import { Pager } from "@/components/shared/pager";
import { ErrorBanner } from "@/components/shared/error-banner";
import {
  FilterBar,
  PageHeader,
  Panel,
  StatCard,
} from "@/components/shared/page";
import { EmptyState } from "@/components/self-hosted/empty-state";
import { api } from "@/utils/api";
import { REQUEST_ENDPOINTS } from "@/utils/api-endpoints";
import { useApiQuery } from "@/hooks/use-api-query";
import { ApiRequestLog } from "@/types/api";
import { useI18n } from "@/i18n/provider";

type RequestLog = {
  id: string;
  createdAt: string;
  method: string;
  path: string;
  statusCode: number;
  latencyMs: number;
  /** The API key that made the call; null for calls logged before keys were recorded. */
  keyName: string | null;
};

type StatusFilter = "all" | "ok" | "errors";

const REQUEST_LOG_LIMIT = 200;
const PAGE_SIZE = 20;
const ALL_KEYS = "__all__";

const normalizeLog = (
  entry: ApiRequestLog,
  adminKeyName: string,
): RequestLog => ({
  id: entry.id,
  createdAt: entry.created_at,
  method: entry.method,
  path: entry.path,
  statusCode: entry.status_code,
  latencyMs: entry.latency_ms,
  keyName:
    entry.auth_type === "admin_api_key"
      ? adminKeyName
      : entry.key_label || null,
});

export default function RequestsPage() {
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [key, setKey] = useState(ALL_KEYS);
  const { t, dateLocale } = useI18n();

  const {
    data: logs = [],
    isLoading,
    error,
    refetch,
  } = useApiQuery<RequestLog[]>(
    async () => {
      const res = await api.get<ApiRequestLog[]>(REQUEST_ENDPOINTS.BASE, {
        params: { limit: REQUEST_LOG_LIMIT },
      });
      setLastUpdated(new Date().toISOString());
      return (res.data ?? []).map((entry) =>
        normalizeLog(entry, t.requests.adminKey),
      );
    },
    { errorToast: t.requests.loadFailed, initialData: [] },
  );

  const keyOptions = useMemo(
    () =>
      Array.from(
        new Set(logs.flatMap((log) => (log.keyName ? [log.keyName] : []))),
      ).sort((a, b) => a.localeCompare(b)),
    [logs],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return logs.filter((log) => {
      if (status === "ok" && log.statusCode >= 400) return false;
      if (status === "errors" && log.statusCode < 400) return false;
      if (key !== ALL_KEYS && log.keyName !== key) return false;
      return !needle || log.path.toLowerCase().includes(needle);
    });
  }, [logs, query, status, key]);

  const totalRequests = logs.length;
  const successfulRequests = logs.filter((log) => log.statusCode < 400).length;
  const successRate =
    totalRequests > 0
      ? Math.round((successfulRequests / totalRequests) * 100)
      : 0;
  const averageLatency =
    totalRequests > 0
      ? Math.round(
          logs.reduce((sum, log) => sum + log.latencyMs, 0) / totalRequests,
        )
      : 0;

  const fullDate = (value: string) =>
    format(new Date(value), t.common.dateTimeFormat, { locale: dateLocale });
  // Today's requests show the time only; older ones add the date.
  const shortTime = (value: string) => {
    const date = new Date(value);
    return format(date, isToday(date) ? "HH:mm:ss" : "MMM d, HH:mm", {
      locale: dateLocale,
    });
  };
  const ago = (value: string) =>
    formatDistanceToNow(new Date(value), {
      addSuffix: true,
      locale: dateLocale,
    });

  const renderKey = (name: string | null) =>
    name ? (
      <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
        <KeyRound className="size-3.5 shrink-0 text-ink-3" aria-hidden />
        <span className="truncate" title={name}>
          {name}
        </span>
      </span>
    ) : (
      <span className="text-ink-3" title={t.requests.keyUnknown}>
        --
      </span>
    );

  const columns: Column<RequestLog>[] = [
    {
      key: "createdAt",
      label: t.requests.columns.time,
      render: (value) => (
        <time
          dateTime={String(value)}
          className="tabular text-ink-2"
          title={fullDate(String(value))}
        >
          {shortTime(String(value))}
        </time>
      ),
    },
    {
      key: "method",
      label: t.requests.columns.method,
      render: (value) => (
        <Badge className={getMethodClassName(String(value))}>
          {String(value).toUpperCase()}
        </Badge>
      ),
    },
    {
      key: "path",
      label: t.requests.columns.path,
      render: (value) => (
        <span
          className="block max-w-[180px] truncate font-mono text-xs text-ink xl:max-w-[320px]"
          title={String(value)}
        >
          {String(value)}
        </span>
      ),
    },
    {
      key: "statusCode",
      label: t.requests.columns.status,
      render: (value) => (
        <Badge className={getStatusClassName(Number(value))}>
          {String(value)}
        </Badge>
      ),
    },
    {
      key: "latencyMs",
      label: t.requests.columns.latency,
      align: "right",
      className: "tabular text-ink-2",
      render: (value) => t.common.ms(Math.round(Number(value))),
    },
    {
      key: "keyName",
      label: t.requests.columns.key,
      className: "max-w-[160px] text-ink-2",
      render: (value) => renderKey(value ? String(value) : null),
    },
  ];

  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <>
      <PageHeader
        title={t.requests.title}
        description={
          <>
            {t.requests.subtitle}
            {lastUpdated && (
              <span className="block text-xs text-ink-3">
                {t.common.lastUpdated(ago(lastUpdated))}
              </span>
            )}
          </>
        }
        actions={
          <Button
            variant="outline"
            onClick={() => {
              setPage(0);
              void refetch();
            }}
            disabled={isLoading}
          >
            <RefreshCw className={isLoading ? "animate-spin" : undefined} />
            {t.common.refresh}
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-3 gap-2.5 sm:gap-4">
        <StatCard
          label={t.requests.totalRequests}
          value={totalRequests}
          hint={t.requests.lastN(REQUEST_LOG_LIMIT)}
          icon={Activity}
          tone="brand"
        />
        <StatCard
          label={t.requests.successRate}
          value={totalRequests > 0 ? `${successRate}%` : "--"}
          icon={CheckCircle2}
          tone={successRate >= 95 || !totalRequests ? "success" : "warning"}
        />
        <StatCard
          label={t.requests.avgLatency}
          value={totalRequests > 0 ? t.common.ms(averageLatency) : "--"}
          icon={Timer}
        />
      </div>

      {error && !isLoading && (
        <ErrorBanner message={error} onRetry={() => void refetch()} />
      )}

      <Panel>
        <FilterBar>
          <SearchInput
            value={query}
            onValueChange={(value) => {
              setQuery(value);
              setPage(0);
            }}
            placeholder={t.requests.searchPath}
            aria-label={t.requests.searchPath}
            containerClassName="md:w-72"
          />
          <Segmented
            label={t.requests.statusFilter}
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(0);
            }}
            options={[
              { value: "all", label: t.requests.statusAll },
              { value: "ok", label: t.requests.statusOk },
              { value: "errors", label: t.requests.statusErrors },
            ]}
          />
          {keyOptions.length > 0 && (
            <Select
              value={key}
              onValueChange={(value) => {
                setKey(value);
                setPage(0);
              }}
            >
              <SelectTrigger
                className="md:w-44"
                aria-label={t.requests.keyFilter}
              >
                <SelectValue placeholder={t.requests.allKeys} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_KEYS}>{t.requests.allKeys}</SelectItem>
                {keyOptions.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FilterBar>

        {isLoading ? (
          <TableSkeleton rows={6} columns={6} />
        ) : logs.length === 0 ? (
          <EmptyState
            title={t.requests.emptyTitle}
            description={t.requests.emptyDescription}
            image="requests"
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            title={t.requests.noMatches}
            description={t.requests.noMatchesHint}
            image="requests"
          >
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setQuery("");
                setStatus("all");
                setKey(ALL_KEYS);
              }}
            >
              {t.common.clearFilters}
            </Button>
          </EmptyState>
        ) : (
          <>
            <DataTable
              data={pageRows}
              columns={columns}
              getRowKey={(row) => row.id}
              caption={t.requests.title}
              renderMobileCard={(row) => (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <Badge className={getMethodClassName(row.method)}>
                      {row.method.toUpperCase()}
                    </Badge>
                    <Badge className={getStatusClassName(row.statusCode)}>
                      {row.statusCode}
                    </Badge>
                    <span className="tabular ml-auto text-xs text-ink-3">
                      {t.common.ms(Math.round(row.latencyMs))}
                    </span>
                  </div>
                  <p className="break-all font-mono text-xs text-ink">
                    {row.path}
                  </p>
                  <div className="flex min-w-0 items-center gap-2 text-xs text-ink-3">
                    <span className="shrink-0" title={fullDate(row.createdAt)}>
                      {ago(row.createdAt)}
                    </span>
                    <span aria-hidden>·</span>
                    {renderKey(row.keyName)}
                  </div>
                </div>
              )}
            />
            <Pager
              page={page}
              pageSize={PAGE_SIZE}
              shown={pageRows.length}
              total={filtered.length}
              onPageChange={setPage}
            />
          </>
        )}
      </Panel>
    </>
  );
}
