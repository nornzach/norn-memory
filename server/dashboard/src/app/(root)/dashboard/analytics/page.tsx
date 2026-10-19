"use client";

import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { RefreshCw } from "lucide-react";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/shared/data-table";
import { TableSkeleton } from "@/components/shared/table-skeleton";
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

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <Card className="border-memBorder-primary min-w-0">
      <CardContent className="p-4">
        <p className="text-xs text-onSurface-default-tertiary truncate">
          {label}
        </p>
        <p className="text-xl md:text-2xl font-semibold mt-1 tabular-nums whitespace-nowrap">
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

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
    <div className="rounded-md border border-memBorder-primary bg-surface-default-primary px-3 py-2 shadow-md text-xs space-y-1">
      <p className="font-medium text-onSurface-default-primary">
        {point.label}
      </p>
      {SERIES.map((series) => (
        <p
          key={series.key}
          className="flex items-center gap-2 text-onSurface-default-secondary"
        >
          <span
            className="size-2 rounded-sm"
            style={{ background: series.color }}
          />
          {t.analytics.series[series.key]}
          <span className="ml-auto pl-3 tabular-nums text-onSurface-default-primary">
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

  const { data, isLoading, refetch } = useApiQuery<AnalyticsResponse>(
    async () => {
      const res = await api.get<AnalyticsResponse>(ANALYTICS_ENDPOINTS.BASE, {
        params: { range },
      });
      return res.data;
    },
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

  const endpointColumns = [
    {
      key: "method" as keyof EndpointRow,
      label: t.analytics.columns.method,
      width: 95,
      render: (value: string) => (
        <Badge variant="outline" className={getMethodClassName(value)}>
          {value}
        </Badge>
      ),
    },
    {
      key: "path" as keyof EndpointRow,
      label: t.analytics.columns.endpoint,
      width: 220,
      render: (value: string) => (
        <code className="text-xs font-mono">{value}</code>
      ),
    },
    {
      key: "requests" as keyof EndpointRow,
      label: t.analytics.columns.requests,
      width: 80,
      render: (value: number) => value.toLocaleString(),
    },
    {
      key: "errors" as keyof EndpointRow,
      label: t.analytics.columns.errors,
      width: 70,
      render: (value: number) => value.toLocaleString(),
    },
    {
      key: "avg_latency_ms" as keyof EndpointRow,
      label: t.analytics.columns.avgLatency,
      width: 90,
      render: (value: number) => t.common.ms(value),
    },
  ];

  return (
    <div className="space-y-4 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 basis-72">
          <h1 className="text-xl font-semibold font-fustat">
            {t.analytics.title}
          </h1>
          <p className="text-sm text-onSurface-default-secondary mt-1">
            {t.analytics.subtitle}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div
            role="group"
            aria-label={t.analytics.timeRange}
            className="flex rounded-md border border-memBorder-primary p-0.5"
          >
            {RANGES.map((option) => (
              <Button
                key={option}
                variant="ghost"
                size="sm"
                aria-pressed={range === option}
                onClick={() => setRange(option)}
                className={cn(
                  "h-7 px-3",
                  range === option && "bg-surface-default-tertiary",
                )}
              >
                {t.analytics.ranges[option]}
              </Button>
            ))}
          </div>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            aria-label={t.common.refresh}
            onClick={() => void refetch()}
          >
            <RefreshCw className={cn("size-4", isLoading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {isLoading && !data ? (
        <TableSkeleton rows={4} columns={4} />
      ) : !data ? (
        <EmptyState title={t.analytics.unavailable} image="requests" />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <StatTile
              label={t.analytics.requests}
              value={formatNumber(data.totals.requests)}
            />
            <StatTile
              label={t.analytics.successRate}
              value={formatNumber(data.totals.success_rate, "%")}
            />
            <StatTile
              label={t.analytics.avgLatency}
              value={formatLatency(data.totals.avg_latency_ms)}
            />
            <StatTile
              label={t.analytics.p95Latency}
              value={formatLatency(data.totals.p95_latency_ms)}
            />
            <StatTile
              label={t.analytics.memoriesStored}
              value={formatNumber(data.total_memories)}
            />
          </div>

          <Card className="border-memBorder-primary">
            <CardHeader className="pb-2 flex flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2 space-y-0">
              <CardTitle className="text-sm">
                {t.analytics.requestsOverTime}
              </CardTitle>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-onSurface-default-secondary">
                  {SERIES.map((series) => (
                    <li key={series.key} className="flex items-center gap-1.5">
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
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setShowTable((v) => !v)}
                >
                  {showTable ? t.analytics.showChart : t.analytics.showTable}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-2">
              {data.totals.requests === 0 ? (
                <p className="h-[220px] flex items-center justify-center text-sm text-onSurface-default-tertiary">
                  {t.analytics.noRequestsYet}
                </p>
              ) : showTable ? (
                <div className="max-h-[260px] overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-onSurface-default-tertiary">
                      <tr>
                        <th className="text-left font-medium py-1">
                          {t.analytics.period}
                        </th>
                        {SERIES.map((s) => (
                          <th
                            key={s.key}
                            className="text-right font-medium py-1"
                          >
                            {t.analytics.series[s.key]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="tabular-nums">
                      {chartData.map((point) => (
                        <tr
                          key={point.label}
                          className="border-t border-memBorder-primary"
                        >
                          <td className="py-1">{point.label}</td>
                          <td className="py-1 text-right">{point.ok}</td>
                          <td className="py-1 text-right">{point.errors}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={chartData}
                      margin={{ top: 4, right: 4, bottom: 0, left: -16 }}
                    >
                      <CartesianGrid
                        vertical={false}
                        stroke="var(--mem-border-primary)"
                      />
                      <XAxis
                        dataKey="label"
                        tickLine={false}
                        axisLine={false}
                        minTickGap={16}
                        tick={{
                          fontSize: 11,
                          fill: "var(--on-surface-default-tertiary)",
                        }}
                      />
                      <YAxis
                        allowDecimals={false}
                        tickLine={false}
                        axisLine={false}
                        tick={{
                          fontSize: 11,
                          fill: "var(--on-surface-default-tertiary)",
                        }}
                      />
                      <Tooltip
                        cursor={{ fill: "var(--surface-default-tertiary)" }}
                        content={<ChartTooltip />}
                      />
                      {SERIES.map((series) => (
                        <Bar
                          key={series.key}
                          dataKey={series.key}
                          name={t.analytics.series[series.key]}
                          stackId="requests"
                          fill={series.color}
                          stroke="var(--surface-default-primary)"
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
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="border-memBorder-primary overflow-hidden min-w-0 lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  {t.analytics.endpoints}
                </CardTitle>
              </CardHeader>
              {endpointRows.length === 0 ? (
                <CardContent className="text-sm text-onSurface-default-tertiary">
                  {t.analytics.noRequests}
                </CardContent>
              ) : (
                <DataTable
                  data={endpointRows}
                  columns={endpointColumns}
                  getRowKey={(row) => row.key}
                />
              )}
            </Card>

            <Card className="border-memBorder-primary min-w-0">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  {t.analytics.memoriesByCategory}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.categories.length === 0 ? (
                  <p className="text-sm text-onSurface-default-tertiary">
                    {t.analytics.noTagged}
                  </p>
                ) : (
                  data.categories.map((category) => (
                    <div key={category.name} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-onSurface-default-primary">
                          {category.name}
                        </span>
                        <span className="tabular-nums text-onSurface-default-secondary">
                          {category.memories.toLocaleString()}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-surface-default-secondary">
                        <div
                          className="h-2 rounded-full"
                          style={{
                            width: `${(category.memories / maxCategory) * 100}%`,
                            background: "var(--chart-requests)",
                          }}
                        />
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
