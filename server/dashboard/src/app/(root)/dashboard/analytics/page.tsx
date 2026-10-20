"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import {
  Activity,
  CheckCircle2,
  Database,
  Gauge,
  RefreshCw,
  Timer,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Column, DataTable } from "@/components/shared/data-table";
import { TableSkeleton } from "@/components/shared/table-skeleton";
import { ErrorBanner } from "@/components/shared/error-banner";
import {
  PageHeader,
  Panel,
  PanelBody,
  PanelHeader,
  StatCard,
} from "@/components/shared/page";
import { EmptyState } from "@/components/self-hosted/empty-state";
import { getMethodClassName } from "@/lib/http-badges";
import { cn } from "@/lib/utils";
import { api } from "@/utils/api";
import { ANALYTICS_ENDPOINTS } from "@/utils/api-endpoints";
import { useApiQuery } from "@/hooks/use-api-query";
import { AnalyticsRange, AnalyticsResponse } from "@/types/api";
import { useI18n } from "@/i18n/provider";

const RANGES: AnalyticsRange[] = ["24h", "7d", "30d"];

const SERIES = [
  { key: "ok", color: "var(--chart-requests)" },
  { key: "errors", color: "var(--chart-errors)" },
] as const;

type EndpointRow = AnalyticsResponse["endpoints"][number] & { key: string };

const formatNumber = (value: number | null | undefined, suffix = "") =>
  value === null || value === undefined
    ? "--"
    : `${value.toLocaleString()}${suffix}`;

const formatLatency = (ms: number | null | undefined) =>
  ms === null || ms === undefined
    ? "--"
    : ms >= 1000
      ? `${(ms / 1000).toFixed(1)} s`
      : `${Math.round(ms)} ms`;

interface TooltipPayload {
  payload: { label: string; ok: number; errors: number };
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
}) {
  const { t } = useI18n();
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="min-w-40 space-y-1 rounded-lg border border-line bg-panel px-3 py-2 text-xs shadow-elev-2">
      <p className="font-medium text-ink">{point.label}</p>
      {SERIES.map((series) => (
        <p key={series.key} className="flex items-center gap-2 text-ink-2">
          <span
            className="size-2 rounded-sm"
            style={{ background: series.color }}
          />
          {t.analytics.series[series.key]}
          <span className="tabular ml-auto pl-3 font-medium text-ink">
            {point[series.key].toLocaleString()}
          </span>
        </p>
      ))}
    </div>
  );
}

export default function AnalyticsPage() {
  const [range, setRange] = useState<AnalyticsRange>("7d");
  const [showTable, setShowTable] = useState(false);
  const { t, dateLocale } = useI18n();

  const { data, isLoading, error, refetch } = useApiQuery<AnalyticsResponse>(
    async () =>
      (
        await api.get<AnalyticsResponse>(ANALYTICS_ENDPOINTS.BASE, {
          params: { range },
        })
      ).data,
    { errorToast: t.analytics.loadFailed },
  );

  // useApiQuery fetches on mount; refetch only when the range changes after that.
  const isFirstRange = useRef(true);
  useEffect(() => {
    if (isFirstRange.current) {
      isFirstRange.current = false;
      return;
    }
    void refetch();
  }, [range, refetch]);

  const timeFormat =
    data?.granularity === "hour"
      ? t.analytics.hourFormat
      : t.analytics.dayFormat;
  const chartData = (data?.series ?? []).map((point) => ({
    label: format(new Date(point.bucket), timeFormat, { locale: dateLocale }),
    ok: point.requests - point.errors,
    errors: point.errors,
  }));
  const endpointRows: EndpointRow[] = (data?.endpoints ?? []).map((e) => ({
    ...e,
    key: `${e.method} ${e.path}`,
  }));
  const maxCategory = Math.max(
    1,
    ...(data?.categories ?? []).map((c) => c.memories),
  );

  const endpointColumns: Column<EndpointRow>[] = [
    {
      key: "method",
      label: t.analytics.columns.method,
      render: (value) => (
        <Badge className={getMethodClassName(String(value))}>
          {String(value)}
        </Badge>
      ),
    },
    {
      key: "path",
      label: t.analytics.columns.endpoint,
      wrap: true,
      render: (value) => (
        <code className="break-all font-mono text-xs text-ink">
          {String(value)}
        </code>
      ),
    },
    {
      key: "requests",
      label: t.analytics.columns.requests,
      align: "right",
      className: "tabular",
      render: (value) => Number(value).toLocaleString(),
    },
    {
      key: "errors",
      label: t.analytics.columns.errors,
      align: "right",
      render: (value) => (
        <span
          className={cn(
            "tabular",
            Number(value) > 0 ? "text-danger" : "text-ink-3",
          )}
        >
          {Number(value).toLocaleString()}
        </span>
      ),
    },
    {
      key: "avg_latency_ms",
      label: t.analytics.columns.avgLatency,
      align: "right",
      className: "tabular text-ink-2",
      render: (value) => formatLatency(Number(value)),
    },
  ];

  return (
    <>
      <PageHeader
        title={t.analytics.title}
        description={t.analytics.subtitle}
        actions={
          <>
            <Segmented
              label={t.analytics.timeRange}
              value={range}
              onChange={setRange}
              options={RANGES.map((option) => ({
                value: option,
                label: t.analytics.ranges[option],
              }))}
            />
            <Button
              variant="outline"
              size="icon"
              aria-label={t.common.refresh}
              title={t.common.refresh}
              onClick={() => void refetch()}
              disabled={isLoading}
            >
              <RefreshCw className={isLoading ? "animate-spin" : undefined} />
            </Button>
          </>
        }
      />

      {error && !isLoading && (
        <ErrorBanner message={error} onRetry={() => void refetch()} />
      )}

      {isLoading && !data ? (
        <Panel>
          <TableSkeleton rows={4} columns={4} />
        </Panel>
      ) : !data ? (
        <Panel>
          <EmptyState title={t.analytics.unavailable} image="requests" />
        </Panel>
      ) : (
        <div
          className={cn(
            "space-y-4 transition-opacity sm:space-y-6",
            isLoading && "opacity-60",
          )}
        >
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-4 xl:grid-cols-5">
            <StatCard
              label={t.analytics.requests}
              value={formatNumber(data.totals.requests)}
              icon={Activity}
              tone="brand"
            />
            <StatCard
              label={t.analytics.successRate}
              value={formatNumber(data.totals.success_rate, "%")}
              icon={CheckCircle2}
              tone="success"
            />
            <StatCard
              label={t.analytics.avgLatency}
              value={formatLatency(data.totals.avg_latency_ms)}
              icon={Timer}
            />
            <StatCard
              label={t.analytics.p95Latency}
              value={formatLatency(data.totals.p95_latency_ms)}
              icon={Gauge}
            />
            <div className="col-span-2 lg:col-span-1">
              <StatCard
                label={t.analytics.memoriesStored}
                value={formatNumber(data.total_memories)}
                icon={Database}
              />
            </div>
          </div>

          <Panel>
            <PanelHeader
              title={t.analytics.requestsOverTime}
              actions={
                <>
                  <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
                    {SERIES.map((series) => (
                      <li
                        key={series.key}
                        className="flex items-center gap-1.5"
                      >
                        <span
                          className="size-2.5 rounded-sm"
                          style={{ background: series.color }}
                        />
                        {t.analytics.series[series.key]}
                      </li>
                    ))}
                  </ul>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => setShowTable((v) => !v)}
                    aria-pressed={showTable}
                  >
                    {showTable ? t.analytics.showChart : t.analytics.showTable}
                  </Button>
                </>
              }
            />
            <PanelBody className="pt-3 sm:pt-4">
              {data.totals.requests === 0 ? (
                <p className="flex h-[240px] items-center justify-center text-center text-sm text-ink-3">
                  {t.analytics.noRequestsYet}
                </p>
              ) : showTable ? (
                <div className="scrollbar-thin max-h-[280px] overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-panel text-xs text-ink-3">
                      <tr>
                        <th className="py-1.5 text-left font-medium">
                          {t.analytics.period}
                        </th>
                        {SERIES.map((s) => (
                          <th
                            key={s.key}
                            className="py-1.5 text-right font-medium"
                          >
                            {t.analytics.series[s.key]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="tabular text-ink">
                      {chartData.map((point) => (
                        <tr key={point.label} className="border-t border-line">
                          <td className="py-1.5">{point.label}</td>
                          <td className="py-1.5 text-right">{point.ok}</td>
                          <td className="py-1.5 text-right">{point.errors}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={chartData}
                      margin={{ top: 4, right: 4, bottom: 0, left: -16 }}
                    >
                      <CartesianGrid
                        vertical={false}
                        stroke="var(--chart-grid)"
                      />
                      <XAxis
                        dataKey="label"
                        tickLine={false}
                        axisLine={false}
                        minTickGap={16}
                        tick={{ fontSize: 11, fill: "var(--ink-3)" }}
                      />
                      <YAxis
                        allowDecimals={false}
                        tickLine={false}
                        axisLine={false}
                        tick={{ fontSize: 11, fill: "var(--ink-3)" }}
                      />
                      <Tooltip
                        cursor={{ fill: "var(--subtle)" }}
                        content={<ChartTooltip />}
                      />
                      {SERIES.map((series) => (
                        <Bar
                          key={series.key}
                          dataKey={series.key}
                          name={t.analytics.series[series.key]}
                          stackId="requests"
                          fill={series.color}
                          stroke="var(--panel)"
                          strokeWidth={2}
                          radius={[4, 4, 0, 0]}
                          maxBarSize={28}
                          isAnimationActive={false}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </PanelBody>
          </Panel>

          <div className="grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-3">
            <Panel className="xl:col-span-2">
              <PanelHeader title={t.analytics.endpoints} />
              {endpointRows.length === 0 ? (
                <PanelBody className="text-sm text-ink-3">
                  {t.analytics.noRequests}
                </PanelBody>
              ) : (
                <DataTable
                  data={endpointRows}
                  columns={endpointColumns}
                  caption={t.analytics.endpoints}
                  getRowKey={(row) => row.key}
                  renderMobileCard={(row) => (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <Badge className={getMethodClassName(row.method)}>
                          {row.method}
                        </Badge>
                        <code className="min-w-0 break-all font-mono text-xs text-ink">
                          {row.path}
                        </code>
                      </div>
                      <p className="tabular text-xs text-ink-3">
                        {row.requests.toLocaleString()}{" "}
                        {t.analytics.columns.requests} ·{" "}
                        <span className={row.errors > 0 ? "text-danger" : ""}>
                          {row.errors.toLocaleString()}{" "}
                          {t.analytics.columns.errors}
                        </span>{" "}
                        · {formatLatency(row.avg_latency_ms)}
                      </p>
                    </div>
                  )}
                />
              )}
            </Panel>

            <Panel>
              <PanelHeader title={t.analytics.memoriesByCategory} />
              <PanelBody className="space-y-3.5">
                {data.categories.length === 0 ? (
                  <p className="text-sm text-ink-3">
                    {t.analytics.noTagged}{" "}
                    <Link
                      href="/dashboard/categories"
                      className="font-medium text-brand-text underline-offset-4 hover:underline"
                    >
                      {t.nav.categories}
                    </Link>
                  </p>
                ) : (
                  data.categories.map((category) => (
                    <Link
                      key={category.name}
                      href={`/dashboard/memories?category=${encodeURIComponent(category.name)}`}
                      className="group block space-y-1.5 rounded-md focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--focus)]"
                    >
                      <div className="flex justify-between gap-2 text-[13px]">
                        <span className="truncate text-ink group-hover:text-brand-text">
                          {category.name}
                        </span>
                        <span className="tabular text-ink-2">
                          {category.memories.toLocaleString()}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-subtle">
                        <div
                          className="h-2 rounded-full bg-chart-1"
                          style={{
                            width: `${(category.memories / maxCategory) * 100}%`,
                          }}
                        />
                      </div>
                    </Link>
                  ))
                )}
              </PanelBody>
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}
