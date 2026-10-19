"use client";

import { Label } from "@/components/ui/label";
import { useI18n } from "@/i18n/provider";
import { Memory, Provenance } from "@/types/api";

const FIELDS = ["device", "agent", "project", "cwd", "key_label"] as const;

/** A memory's provenance. The server stores it in metadata; read the top level as a fallback. */
export function memorySource(memory: Memory): Provenance {
  const metadata = memory.metadata ?? {};
  const source: Provenance = {};
  for (const field of FIELDS) {
    const value =
      metadata[field] ?? (memory as unknown as Record<string, unknown>)[field];
    if (typeof value === "string" && value) source[field] = value;
  }
  return source;
}

/** Table cell: the project on top, device and agent below. */
export function SourceCell({ source }: { source: Provenance }) {
  const { t } = useI18n();
  const where = [source.device, source.agent].filter(Boolean).join(" · ");
  if (!source.project && !where) {
    return (
      <span className="text-xs text-onSurface-default-tertiary">
        {t.common.none}
      </span>
    );
  }
  return (
    <div className="min-w-0" title={source.cwd ?? undefined}>
      {source.project && <p className="truncate text-sm">{source.project}</p>}
      {where && (
        <p className="truncate text-xs text-onSurface-default-tertiary">
          {where}
        </p>
      )}
    </div>
  );
}

/** Detail-sheet block listing every recorded provenance field. */
export function SourceDetails({ source }: { source: Provenance }) {
  const { t } = useI18n();
  const rows: [string, string | null | undefined, boolean][] = [
    [t.source.project, source.project, false],
    [t.source.device, source.device, false],
    [t.source.agent, source.agent, false],
    [t.source.apiKey, source.key_label, false],
    [t.source.folder, source.cwd, true],
  ];
  const recorded = rows.filter(([, value]) => value);
  return (
    <div className="space-y-1">
      <Label className="text-xs text-onSurface-default-tertiary">
        {t.source.column}
      </Label>
      {recorded.length ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
          {recorded.map(([label, value, wide]) => (
            <div key={label} className={wide ? "col-span-2" : undefined}>
              <dt className="text-xs text-onSurface-default-tertiary">
                {label}
              </dt>
              <dd
                className={
                  wide ? "font-mono text-xs break-all" : "text-sm break-words"
                }
              >
                {value}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-onSurface-default-tertiary">
          {t.source.noSource}
        </p>
      )}
    </div>
  );
}
