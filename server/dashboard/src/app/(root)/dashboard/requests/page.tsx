"use client";

import { useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getMethodClassName, getStatusClassName } from "@/lib/http-badges";
import { DataTable } from "@/components/shared/data-table";
import { TableSkeleton } from "@/components/shared/table-skeleton";
import { EmptyState } from "@/components/self-hosted/empty-state";
import { api } from "@/utils/api";
import { REQUEST_ENDPOINTS } from "@/utils/api-endpoints";
import { useApiQuery } from "@/hooks/use-api-query";
import { ApiRequestLog } from "@/types/api";
import { useI18n } from "@/i18n/provider";
import type { Messages } from "@/i18n/messages";

type RequestLog = {
  id: string;
  createdAt: string;
  method: string;
  path: string;
  statusCode: number;
  latencyMs: number;
  authType: string;
};

const REQUEST_LOG_LIMIT = 200;
const PAGE_SIZE = 20;

const getAuthLabel = (
  authType: string,
  labels: Messages["requests"]["auth"],
) => {
  switch (authType.toLowerCase()) {
    case "bearer":
      return labels.bearer;
    case "api_key":
      return labels.apiKey;
    case "admin_api_key":
      return labels.adminKey;
    case "disabled":
      return labels.disabled;
    default:
      return "--";
  }
};

const normalizeLog = (entry: ApiRequestLog): RequestLog => {
  return {
    id: entry.id,
    createdAt: entry.created_at,
    method: entry.method,
    path: entry.path,
    statusCode: entry.status_code,
    latencyMs: entry.latency_ms,
    authType: entry.auth_type,
  };
};

export default function RequestsPage() {
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [page, setPage] = useState(0);
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
      return (res.data ?? []).map(normalizeLog);
    },
    { errorToast: t.requests.loadFailed, initialData: [] },
  );

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

  const columns = [
    {
      key: "createdAt" as keyof RequestLog,
      label: t.requests.columns.time,
      width: 140,
      render: (value: string) => (
        <span
          title={format(new Date(value), t.common.dateTimeFormat, {
            locale: dateLocale,
          })}
        >
          {formatDistanceToNow(new Date(value), {
            addSuffix: true,
            locale: dateLocale,
          })}
        </span>
      ),
    },
    {
      key: "method" as keyof RequestLog,
      label: t.requests.columns.method,
      width: 96,
      render: (value: string) => (
        <Badge variant="outline" className={getMethodClassName(value)}>
          {value.toUpperCase()}
        </Badge>
      ),
    },
    {
      key: "path" as keyof RequestLog,
      label: t.requests.columns.path,
      width: 360,
      render: (value: string) => (
        <span className="font-mono text-xs break-all text-onSurface-default-primary">
          {value}
        </span>
      ),
    },
    {
      key: "statusCode" as keyof RequestLog,
      label: t.requests.columns.status,
      width: 120,
      render: (value: number) => (
        <Badge variant="outline" className={getStatusClassName(value)}>
          {value}
        </Badge>
      ),
    },
    {
      key: "latencyMs" as keyof RequestLog,
      label: t.requests.columns.latency,
      width: 100,
      render: (value: number) => <span>{t.common.ms(value)}</span>,
    },
    {
      key: "authType" as keyof RequestLog,
      label: t.requests.columns.auth,
      width: 120,
      render: (value: string) => getAuthLabel(value, t.requests.auth),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold font-fustat">
            {t.requests.title}
          </h1>
          <p className="text-sm text-onSurface-default-secondary">
            {t.requests.subtitle}
          </p>
          {lastUpdated && (
            <p className="text-xs text-onSurface-default-tertiary">
              {t.common.lastUpdated(
                formatDistanceToNow(new Date(lastUpdated), {
                  addSuffix: true,
                  locale: dateLocale,
                }),
              )}
            </p>
          )}
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setPage(0);
            void refetch();
          }}
          disabled={isLoading}
        >
          <RefreshCw className="size-4 mr-2" />
          {t.common.refresh}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {[
          { label: t.requests.totalRequests, value: totalRequests },
          {
            label: t.requests.successRate,
            value: totalRequests > 0 ? `${successRate}%` : "--",
          },
          {
            label: t.requests.avgLatency,
            value: totalRequests > 0 ? t.common.ms(averageLatency) : "--",
          },
        ].map((card) => (
          <Card key={card.label} className="border-memBorder-primary">
            <CardContent className="p-5">
              <p className="text-xs text-onSurface-default-tertiary">
                {card.label}
              </p>
              <p className="mt-1 text-2xl font-semibold">{card.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {error && (
        <Card className="border-memBorder-primary">
          <CardContent className="p-4 text-sm text-onSurface-danger-primary">
            {error}
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <TableSkeleton rows={6} columns={6} />
      ) : logs.length === 0 ? (
        <EmptyState
          title={t.requests.emptyTitle}
          description={t.requests.emptyDescription}
          image="requests"
        />
      ) : (
        <>
          <Card className="border-memBorder-primary overflow-hidden">
            <DataTable
              data={logs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)}
              columns={columns}
              getRowKey={(row) => row.id}
            />
          </Card>
          {logs.length > PAGE_SIZE && (
            <div className="flex items-center justify-between text-sm text-onSurface-default-tertiary">
              <span>
                {t.common.range(
                  page * PAGE_SIZE + 1,
                  Math.min((page + 1) * PAGE_SIZE, logs.length),
                  logs.length,
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
                  disabled={(page + 1) * PAGE_SIZE >= logs.length}
                  onClick={() => setPage((p) => p + 1)}
                >
                  {t.common.next}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
