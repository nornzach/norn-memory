"use client";

import { ChangeEvent, useRef, useState } from "react";
import { FileUp, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { LinearProgress } from "@/components/ui/linearProgress";
import {
  Panel,
  PanelBody,
  PanelFooter,
  PanelHeader,
} from "@/components/shared/page";
import { toast } from "@/components/ui/use-toast";
import { getErrorMessage } from "@/lib/error-message";
import { api } from "@/utils/api";
import { EXPORT_ENDPOINTS } from "@/utils/api-endpoints";
import { useI18n } from "@/i18n/provider";

// The server takes at most 100 per call; smaller batches keep the progress bar moving.
const BATCH_SIZE = 25;

interface ImportItem {
  memory: string;
  user_id?: string | null;
  agent_id?: string | null;
  run_id?: string | null;
  categories?: string[];
  metadata?: Record<string, unknown>;
}

interface ImportResult {
  imported: number;
  skipped: number;
  failed: { index: number; error: string }[];
}

/** Accepts a JSON export ({ memories: [...] }) or a bare array of memories. */
function parseExport(text: string): ImportItem[] | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const list = Array.isArray(data)
    ? data
    : (data as { memories?: unknown })?.memories;
  if (!Array.isArray(list)) return null;
  return list
    .filter(
      (m): m is Record<string, unknown> =>
        typeof m === "object" && m !== null && typeof m.memory === "string",
    )
    .map((m) => ({
      memory: m.memory as string,
      user_id: (m.user_id as string) ?? null,
      agent_id: (m.agent_id as string) ?? null,
      run_id: (m.run_id as string) ?? null,
      categories: Array.isArray(m.categories) ? (m.categories as string[]) : [],
      metadata:
        typeof m.metadata === "object" && m.metadata !== null
          ? (m.metadata as Record<string, unknown>)
          : {},
    }));
}

export function ImportPanel() {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [items, setItems] = useState<ImportItem[] | null>(null);
  const [fileError, setFileError] = useState("");
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [done, setDone] = useState<number | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const running = done !== null;

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setResult(null);
    setFileName(file.name);
    const parsed = parseExport(await file.text());
    if (parsed === null) {
      setItems(null);
      setFileError(t.exportPage.fileInvalid);
    } else if (parsed.length === 0) {
      setItems(null);
      setFileError(t.exportPage.fileEmpty);
    } else {
      setItems(parsed);
      setFileError("");
    }
  };

  const handleImport = async () => {
    if (!items || running) return;
    const total: ImportResult = { imported: 0, skipped: 0, failed: [] };
    setDone(0);
    setResult(null);
    try {
      for (let start = 0; start < items.length; start += BATCH_SIZE) {
        const batch = items.slice(start, start + BATCH_SIZE);
        const res = await api.post<ImportResult>(EXPORT_ENDPOINTS.IMPORT, {
          memories: batch,
          skip_duplicates: skipDuplicates,
        });
        total.imported += res.data.imported;
        total.skipped += res.data.skipped;
        total.failed.push(
          ...res.data.failed.map((f) => ({ ...f, index: f.index + start })),
        );
        setDone(start + batch.length);
      }
      setResult(total);
      toast({
        title: t.exportPage.importDone,
        description: t.exportPage.importResult(
          total.imported,
          total.skipped,
          total.failed.length,
        ),
        variant: total.failed.length ? "default" : "success",
      });
    } catch (error) {
      setResult(total);
      toast({
        title: t.exportPage.importFailed,
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setDone(null);
    }
  };

  return (
    <Panel>
      <PanelHeader
        title={t.exportPage.importTitle}
        description={t.exportPage.importDescription}
      />
      <PanelBody className="space-y-4">
        <input
          ref={inputRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => void handleFile(e)}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={running}
          className="flex w-full items-center gap-3 rounded-xl border border-dashed border-line-strong bg-sunken/60 px-4 py-4 text-left transition-colors hover:border-ink-3/40 hover:bg-subtle focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--focus)] disabled:opacity-45"
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-panel text-ink-3 ring-1 ring-line">
            <FileUp className="size-4" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium text-ink">
              {items ? t.exportPage.chooseAnother : t.exportPage.chooseFile}
            </span>
            <span className="block truncate text-xs text-ink-3">
              {items
                ? t.exportPage.fileSummary(items.length, fileName)
                : fileError || ".json"}
            </span>
          </span>
        </button>
        {fileError && (
          <p role="alert" className="text-xs text-danger">
            {fileError}
          </p>
        )}

        <label className="flex items-start gap-2.5 text-sm text-ink-2">
          <Checkbox
            checked={skipDuplicates}
            onCheckedChange={(v) => setSkipDuplicates(v === true)}
            disabled={running}
            className="mt-0.5"
          />
          {t.exportPage.skipDuplicates}
        </label>

        {running && items && (
          <div className="space-y-1.5" aria-live="polite">
            <LinearProgress value={(done / items.length) * 100} />
            <p className="tabular text-xs text-ink-3">
              {t.exportPage.importing(done, items.length)}
            </p>
          </div>
        )}

        {result && !running && (
          <div className="space-y-1.5 rounded-lg bg-subtle px-3 py-2.5 text-xs">
            <p className="font-medium text-ink">
              {t.exportPage.importResult(
                result.imported,
                result.skipped,
                result.failed.length,
              )}
            </p>
            {result.failed.slice(0, 5).map((f) => (
              <p key={f.index} className="break-words text-danger">
                {t.exportPage.failedItem(f.index, f.error)}
              </p>
            ))}
          </div>
        )}
      </PanelBody>
      <PanelFooter className="sm:justify-end">
        <Button
          onClick={() => void handleImport()}
          disabled={!items || running}
          className="w-full sm:w-auto"
        >
          {running ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <Upload aria-hidden />
          )}
          {t.exportPage.importButton(items?.length ?? 0)}
        </Button>
      </PanelFooter>
    </Panel>
  );
}
