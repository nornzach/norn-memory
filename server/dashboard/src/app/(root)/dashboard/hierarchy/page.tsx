"use client";

import { useMemo } from "react";
import { Layers, Percent, RefreshCw, Star } from "lucide-react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
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
}

const LAYERS: Layer[] = ["L0", "L1", "L2", "L3", "L4"];
// Deepest layers first: the pyramid is widest at the transient base.
const LAYER_COLOR: Record<Layer, string> = {
  L0: "var(--brand)",
  L1: "var(--brand)",
  L2: "var(--chart-requests)",
  L3: "var(--chart-latency)",
  L4: "var(--ink-3)",
};

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
  const empty = !!data && data.total_memories === 0;

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
          label={copy.canonicalCount}
          value={data?.by_layer.L0.count ?? "--"}
          icon={Layers}
          tone="success"
        />
      </div>

      <Panel>
        <PanelHeader title={copy.distribution} />
        <PanelBody>
          {empty ? (
            <EmptyState title={copy.emptyTitle} description={copy.emptyDescription} />
          ) : (
            <div className="flex flex-col gap-3">
              {layers.map(({ layer, label, description, count, avg_importance }) => (
                <div key={layer} className="grid grid-cols-[4.5rem_1fr_5.5rem_4rem] items-center gap-3">
                  <div className="text-sm font-medium text-ink">
                    {layer}
                    <span className="ml-1 text-ink-3">{label}</span>
                  </div>
                  <div className="h-7 w-full rounded-md bg-subtle" title={description}>
                    <div
                      className="flex h-7 items-center justify-end rounded-md px-2 text-xs font-medium text-white transition-[width]"
                      style={{
                        width: `${Math.max(4, (count / widest) * 100)}%`,
                        backgroundColor: LAYER_COLOR[layer],
                      }}
                    >
                      {count}
                    </div>
                  </div>
                  <div className="text-right text-sm text-ink-3">
                    {count ? `${avg_importance.toFixed(1)} / 10` : "--"}
                  </div>
                  <div className="text-right text-xs text-ink-3">
                    {data && data.total_memories ? `${Math.round((count / data.total_memories) * 100)}%` : "--"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </PanelBody>
      </Panel>

      {contexts.length > 0 ? (
        <Panel>
          <PanelHeader title={copy.contextBreakdown} />
          <PanelBody className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={contexts} layout="vertical" margin={{ left: 8, right: 16 }}>
                <XAxis type="number" allowDecimals={false} stroke="var(--ink-3)" fontSize={12} />
                <YAxis
                  type="category"
                  dataKey="context"
                  width={160}
                  stroke="var(--ink-3)"
                  fontSize={12}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: "var(--subtle)" }}
                  contentStyle={{
                    background: "var(--panel)",
                    border: "1px solid var(--line)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {contexts.map((entry) => (
                    <Cell key={entry.context} fill="var(--brand)" />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </PanelBody>
        </Panel>
      ) : null}
    </div>
  );
}
