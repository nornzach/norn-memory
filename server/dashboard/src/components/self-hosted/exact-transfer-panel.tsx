"use client";

import { ChangeEvent, useRef, useState } from "react";
import { Download, FileUp, KeyRound, Loader2, Upload } from "lucide-react";
import { format as formatDate } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LinearProgress } from "@/components/ui/linearProgress";
import {
  Panel,
  PanelBody,
  PanelFooter,
  PanelHeader,
} from "@/components/shared/page";
import { Field } from "@/components/shared/field";
import { toast } from "@/components/ui/use-toast";
import { getErrorMessage } from "@/lib/error-message";
import { api } from "@/utils/api";
import { EXACT_ENDPOINTS } from "@/utils/api-endpoints";
import { useI18n } from "@/i18n/provider";

// POST /exact/batch takes at most 1000 records, all for one user.
const BATCH_SIZE = 1000;

const RECORD_FIELDS = [
  "kind",
  "title",
  "description",
  "tags",
  "fields",
  "project",
  "cwd",
  "device",
  "agent",
] as const;

type ImportRecord = { key: string } & Record<string, unknown>;

interface BatchResult {
  created: number;
  updated: number;
  unchanged: number;
}

/** Records grouped by owner, from an exact export ({ exact_records: [...] }) or a bare array. */
function parseExactExport(text: string): Map<string, ImportRecord[]> | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const list = Array.isArray(data)
    ? data
    : (data as { exact_records?: unknown })?.exact_records;
  if (!Array.isArray(list)) return null;
  const byUser = new Map<string, ImportRecord[]>();
  for (const raw of list) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.key !== "string" || typeof r.user_id !== "string") continue;
    const record: ImportRecord = { key: r.key };
    for (const field of RECORD_FIELDS) {
      if (r[field] !== undefined && r[field] !== null) record[field] = r[field];
    }
    const group = byUser.get(r.user_id) ?? [];
    group.push(record);
    byUser.set(r.user_id, group);
  }
  return byUser;
}

/** Back up exact records with their values, and restore them on this or another server. Admins only. */
export function ExactTransferPanel() {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [userId, setUserId] = useState("");
  const [exporting, setExporting] = useState(false);
  const [fileName, setFileName] = useState("");
  const [groups, setGroups] = useState<Map<string, ImportRecord[]> | null>(
    null,
  );
  const [fileError, setFileError] = useState("");
  const [done, setDone] = useState<number | null>(null);
  const [result, setResult] = useState<BatchResult | null>(null);

  const total = groups
    ? Array.from(groups.values()).reduce((n, list) => n + list.length, 0)
    : 0;
  const running = done !== null;

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = userId.trim() ? { user_id: userId.trim() } : {};
      const res = await api.get<Blob>(EXACT_ENDPOINTS.EXPORT, {
        params,
        responseType: "blob",
      });
      const url = URL.createObjectURL(res.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = `norn-m-exact-records-${formatDate(new Date(), "yyyyMMdd-HHmmss")}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast({ title: t.exportPage.downloaded, variant: "success" });
    } catch (error) {
      toast({
        title: t.exportPage.failed,
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setResult(null);
    setFileName(file.name);
    const parsed = parseExactExport(await file.text());
    if (parsed === null) {
      setGroups(null);
      setFileError(t.exportPage.exactFileInvalid);
    } else if (parsed.size === 0) {
      setGroups(null);
      setFileError(t.exportPage.exactFileEmpty);
    } else {
      setGroups(parsed);
      setFileError("");
    }
  };

  const handleImport = async () => {
    if (!groups || running) return;
    const counts: BatchResult = { created: 0, updated: 0, unchanged: 0 };
    let sent = 0;
    setDone(0);
    setResult(null);
    try {
      for (const [owner, records] of Array.from(groups.entries())) {
        for (let start = 0; start < records.length; start += BATCH_SIZE) {
          const batch = records.slice(start, start + BATCH_SIZE);
          // A replace, not a merge: each record comes back exactly as it was exported.
          const res = await api.post<BatchResult>(EXACT_ENDPOINTS.BATCH, {
            user_id: owner,
            merge: false,
            records: batch,
          });
          counts.created += res.data.created;
          counts.updated += res.data.updated;
          counts.unchanged += res.data.unchanged;
          sent += batch.length;
          setDone(sent);
        }
      }
      setResult(counts);
      toast({
        title: t.exportPage.importDone,
        description: t.exportPage.exactImportResult(
          counts.created,
          counts.updated,
          counts.unchanged,
        ),
        variant: "success",
      });
    } catch (error) {
      setResult(counts);
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
        title={t.exportPage.exactTitle}
        description={t.exportPage.exactDescription}
      />
      <PanelBody className="space-y-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Field
            id="exact-export-user"
            label={t.common.userId}
            className="sm:flex-1"
          >
            <Input
              id="exact-export-user"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder={t.common.allUsers}
              autoComplete="off"
            />
          </Field>
          <Button
            variant="outline"
            onClick={() => void handleExport()}
            disabled={exporting}
          >
            {exporting ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Download aria-hidden />
            )}
            {t.exportPage.exactExport}
          </Button>
        </div>
        <p className="flex items-start gap-2 text-xs leading-5 text-ink-3">
          <KeyRound className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {t.exportPage.exactWarning}
        </p>

        <div className="space-y-3 border-t border-line pt-5">
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
                {groups
                  ? t.exportPage.chooseAnother
                  : t.exportPage.exactChooseFile}
              </span>
              <span className="block truncate text-xs text-ink-3">
                {groups
                  ? t.exportPage.exactFileSummary(total, groups.size, fileName)
                  : fileError || ".json"}
              </span>
            </span>
          </button>
          {fileError && (
            <p role="alert" className="text-xs text-danger">
              {fileError}
            </p>
          )}
          <p className="text-xs leading-5 text-ink-3">
            {t.exportPage.exactImportHint}
          </p>

          {running && groups && (
            <div className="space-y-1.5" aria-live="polite">
              <LinearProgress value={(done / total) * 100} />
              <p className="tabular text-xs text-ink-3">
                {t.exportPage.exactImporting(done, total)}
              </p>
            </div>
          )}

          {result && !running && (
            <p className="rounded-lg bg-subtle px-3 py-2.5 text-xs font-medium text-ink">
              {t.exportPage.exactImportResult(
                result.created,
                result.updated,
                result.unchanged,
              )}
            </p>
          )}
        </div>
      </PanelBody>
      <PanelFooter className="sm:justify-end">
        <Button
          onClick={() => void handleImport()}
          disabled={!groups || running}
          className="w-full sm:w-auto"
        >
          {running ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <Upload aria-hidden />
          )}
          {t.exportPage.exactImportButton(total)}
        </Button>
      </PanelFooter>
    </Panel>
  );
}
