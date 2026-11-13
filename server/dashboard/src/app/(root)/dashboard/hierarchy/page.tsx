"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ChevronRight, KeySquare, Layers, Percent, RefreshCw, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/shared/error-banner";
import {
  PageHeader,
  Panel,
  PanelBody,
  PanelHeader,
  StatCard,
} from "@/components/shared/page";
import { EmptyState } from "@/components/self-hosted/empty-state";
import { cn } from "@/lib/utils";
import { api } from "@/utils/api";
import { MEMORY_ENDPOINTS } from "@/utils/api-endpoints";
import { useApiQuery } from "@/hooks/use-api-query";
import { useI18n } from "@/i18n/provider";

type Layer = "L0" | "L1" | "L2" | "L3" | "L4";

interface LayerStats {
  count: number;
  total_importance: number;
  avg_importance: number;
}

interface HierarchyStats {
  total_memories: number;
  avg_importance: number;
  by_layer: Record<Layer, LayerStats>;
  context_distribution: Record<string, number>;
  exact_records: number | null;
}

const LAYERS: Layer[] = ["L0", "L1", "L2", "L3", "L4"];
const LAYER_COLOR: Record<Layer, string> = {
  L0: "var(--chart-1)",
  L1: "var(--chart-3)",
  L2: "var(--chart-4)",
  L3: "var(--chart-5)",
  L4: "var(--ink-3)",
};
const CONTEXT_COLORS = ["var(--chart-1)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-2)"];

// Pyramid geometry: the tip is a thin triangle, the base spans the whole viewBox.
const PYRAMID_W = 320;
const PYRAMID_H = 300;
const SLICE_H = PYRAMID_H / LAYERS.length;
const TIP_FRACTION = 0.1;

function slicePoints(index: number): string {
  const topFrac = TIP_FRACTION + ((1 - TIP_FRACTION) * index) / LAYERS.length;
  const bottomFrac = TIP_FRACTION + ((1 - TIP_FRACTION) * (index + 1)) / LAYERS.length;
  const yTop = index * SLICE_H;
  const yBottom = yTop + SLICE_H;
  const x = (frac: number) => ((1 - frac) / 2) * PYRAMID_W;
  return `${x(topFrac)},${yTop} ${PYRAMID_W - x(topFrac)},${yTop} ${PYRAMID_W - x(bottomFrac)},${yBottom} ${x(bottomFrac)},${yBottom}`;
}

function sliceWidth(index: number): number {
  const midFrac = TIP_FRACTION + ((1 - TIP_FRACTION) * (index + 0.5)) / LAYERS.length;
  return midFrac * PYRAMID_W;
}

export default function HierarchyPage() {
  const { t } = useI18n();
  const copy = t.hierarchy;

  const { data, isLoading, error, refetch } = useApiQuery<HierarchyStats>(
    async () => (await api.get<HierarchyStats>(MEMORY_ENDPOINTS.HIERARCHY_STATS)).data,
    { errorToast: copy.loadFailed },
  );

  const layers = useMemo(
    () =>
      LAYERS.map((layer) => ({
        layer,
        label: copy.layers[layer],
        description: copy.layerDescriptions[layer],
        ...(data?.by_layer[layer] ?? { count: 0, avg_importance: 0, total_importance: 0 }),
      })),
    [data, copy],
  );

  const contexts = useMemo(
    () =>
      Object.entries(data?.context_distribution ?? {})
        .sort(([, a], [, b]) => b - a)
        .map(([context, count]) => ({ context, count })),
    [data],
  );

  const widest = Math.max(1, ...layers.map((layer) => layer.count));
  const total = data?.total_memories ?? 0;
  const empty = !!data && total === 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={copy.title}
        description={copy.description}
        actions={
          <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isLoading}>
            <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
            {t.common.retry}
          </Button>
        }
      />

      {error ? <ErrorBanner message={error} onRetry={() => void refetch()} /> : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={copy.totalMemories} value={data?.total_memories ?? "--"} icon={Layers} tone="brand" />
        <StatCard
          label={copy.avgImportance}
          value={data ? data.avg_importance.toFixed(1) : "--"}
          icon={Star}
          tone="warning"
        />
        <StatCard label={copy.contexts} value={contexts.length || (data ? 0 : "--")} icon={Percent} />
        <StatCard
          label={copy.canonicalRecords}
          value={data?.exact_records ?? "--"}
          icon={KeySquare}
          tone="success"
        />
      </div>

      {empty ? (
        <Panel>
          <PanelBody>
            <EmptyState title={copy.emptyTitle} description={copy.emptyDescription} />
          </PanelBody>
        </Panel>
      ) : (
        <Panel>
          <PanelHeader title={copy.distribution} />
          <PanelBody>
            <div className="grid gap-8 lg:grid-cols-[minmax(0,22rem)_1fr] lg:items-center">
              {/* The pyramid itself: each slice is proportional in area, labelled with its layer
                  and count when the trapezoid is wide enough to hold it. */}
              <svg
                viewBox={`0 0 ${PYRAMID_W} ${PYRAMID_H}`}
                role="img"
                aria-label={copy.distribution}
                className="mx-auto w-full max-w-72"
              >
                {layers.map(({ layer, count }, index) => {
                  const midWidth = sliceWidth(index);
                  const label = `${layer} · ${count}`;
                  return (
                    <Link key={layer} href={`/dashboard/memories?layer=${layer}`}>
                      <title>{`${layer} ${copy.layers[layer]}: ${count}`}</title>
                      <polygon
                        points={slicePoints(index)}
                        fill={LAYER_COLOR[layer]}
                        opacity={0.92}
                        className="transition-opacity hover:opacity-100"
                        stroke="var(--panel)"
                        strokeWidth={2}
                      />
                      {midWidth > 110 ? (
                        <text
                          x={PYRAMID_W / 2}
                          y={index * SLICE_H + SLICE_H / 2}
                          dominantBaseline="central"
                          textAnchor="middle"
                          fill="var(--ink-inverse)" className="text-[13px] font-medium"
                        >
                          {label}
                        </text>
                      ) : midWidth > 52 ? (
                        <text
                          x={PYRAMID_W / 2}
                          y={index * SLICE_H + SLICE_H / 2}
                          dominantBaseline="central"
                          textAnchor="middle"
                          fill="var(--ink-inverse)" className="text-[13px] font-medium"
                        >
                          {layer}
                        </text>
                      ) : null}
                    </Link>
                  );
                })}
              </svg>

              {/* Per-layer rows: the numbers behind each slice, linking to the filtered listing. */}
              <div className="flex flex-col gap-1">
                {layers.map(({ layer, label, description, count, avg_importance }) => {
                  const share = total ? count / total : 0;
                  return (
                    <Link
                      key={layer}
                      href={`/dashboard/memories?layer=${layer}`}
                      title={description}
                      className="group relative flex items-center gap-4 overflow-hidden rounded-lg px-3 py-2.5 transition-colors hover:bg-subtle"
                    >
                      <span
                        aria-hidden
                        className="absolute inset-y-0 left-0 rounded-lg bg-subtle transition-[width]"
                        style={{ width: `${Math.min(100, (count / widest) * 100)}%` }}
                      />
                      <span
                        className="relative grid size-8 shrink-0 place-items-center rounded-md text-xs font-semibold text-white"
                        style={{ backgroundColor: LAYER_COLOR[layer] }}
                      >
                        {layer}
                      </span>
                      <span className="relative min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">
                          {label}
                        </span>
                        <span className="block truncate text-xs text-ink-3">{description}</span>
                      </span>
                      <span className="relative text-right">
                        <span className="block text-sm font-medium tabular-nums text-ink">
                          {count.toLocaleString()}
                        </span>
                        <span className="block text-xs tabular-nums text-ink-3">
                          {total ? `${Math.round(share * 100)}% · ${avg_importance.toFixed(1)}/10` : "--"}
                        </span>
                      </span>
                      <ChevronRight className="relative size-4 shrink-0 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                    </Link>
                  );
                })}
              </div>
            </div>
          </PanelBody>
        </Panel>
      )}

      {contexts.length > 0 ? (
        <Panel>
          <PanelHeader title={copy.contextBreakdown} description={copy.contextHint} />
          <PanelBody>
            <div className="flex flex-col gap-1">
              {contexts.map(({ context, count }) => {
                const share = total ? count / total : 0;
                const width = Math.max(4, Math.round(share * 100));
                return (
                  <Link
                    key={context}
                    href={`/dashboard/memories?context=${encodeURIComponent(context)}`}
                    className="group flex items-center gap-4 rounded-lg px-3 py-2 transition-colors hover:bg-subtle"
                  >
                    <span className="w-40 truncate text-sm font-medium text-ink" title={context}>
                      {context}
                    </span>
                    <span className="relative h-5 flex-1 overflow-hidden rounded-md bg-subtle">
                      <span
                        className="absolute inset-y-0 left-0 rounded-md bg-brand opacity-80 transition-[width]"
                        style={{ width: `${width}%` }}
                      />
                    </span>
                    <span className="w-20 shrink-0 text-right text-sm tabular-nums text-ink-3">
                      {count.toLocaleString()}
                      <span className="ml-1 text-xs">({Math.round(share * 100)}%)</span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                  </Link>
                );
              })}
            </div>
          </PanelBody>
        </Panel>
      ) : null}
    </div>
  );
}
