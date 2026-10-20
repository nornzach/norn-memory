"use client";

import { useState } from "react";
import { Braces, Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { format as formatDate } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field } from "@/components/shared/field";
import {
  PageHeader,
  Panel,
  PanelBody,
  PanelFooter,
  PanelHeader,
} from "@/components/shared/page";
import { ImportPanel } from "@/components/self-hosted/import-panel";
import { ExactTransferPanel } from "@/components/self-hosted/exact-transfer-panel";
import { toast } from "@/components/ui/use-toast";
import { getErrorMessage } from "@/lib/error-message";
import { cn } from "@/lib/utils";
import { api } from "@/utils/api";
import { CATEGORY_ENDPOINTS, EXPORT_ENDPOINTS } from "@/utils/api-endpoints";
import { useApiQuery } from "@/hooks/use-api-query";
import { Category } from "@/types/api";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/i18n/provider";

type ExportFormat = "json" | "csv";

const ALL_CATEGORIES = "__all__";

const SAMPLES: Record<ExportFormat, string> = {
  json: `{
  "exported_at": "2026-10-19T12:00:00+00:00",
  "filters": { "user_id": "alice" },
  "total": 1,
  "memories": [
    {
      "id": "3f2c…",
      "memory": "Prefers green tea over coffee",
      "user_id": "alice",
      "categories": ["Preferences"],
      "metadata": {},
      "created_at": "2026-10-18T09:30:00+00:00"
    }
  ]
}`,
  csv: `id,memory,user_id,agent_id,run_id,categories,metadata,created_at,updated_at
3f2c…,Prefers green tea over coffee,alice,,,Preferences,{},2026-10-18T09:30:00+00:00,`,
};

type TextFilter = "user_id" | "agent_id" | "project" | "device" | "agent";

export default function ExportPage() {
  const [exportFormat, setExportFormat] = useState<ExportFormat>("json");
  const [filters, setFilters] = useState<Record<TextFilter, string>>({
    user_id: "",
    agent_id: "",
    project: "",
    device: "",
    agent: "",
  });
  const [category, setCategory] = useState(ALL_CATEGORIES);
  const [isExporting, setIsExporting] = useState(false);
  const { t } = useI18n();
  const { isAdmin } = useAuth();

  const { data: categories = [] } = useApiQuery<Category[]>(
    async () => (await api.get<Category[]>(CATEGORY_ENDPOINTS.BASE)).data ?? [],
    { initialData: [] },
  );

  const setFilter = (key: TextFilter, value: string) =>
    setFilters((current) => ({ ...current, [key]: value }));

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const params: Record<string, string> = { format: exportFormat };
      for (const [key, value] of Object.entries(filters)) {
        if (value.trim()) params[key] = value.trim();
      }
      if (category !== ALL_CATEGORIES) params.category = category;

      // Downloaded through the API client because a plain link can't send the auth header.
      const res = await api.get<Blob>(EXPORT_ENDPOINTS.BASE, {
        params,
        responseType: "blob",
      });
      const url = URL.createObjectURL(res.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = `norn-m-memories-${formatDate(new Date(), "yyyyMMdd-HHmmss")}.${exportFormat}`;
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
      setIsExporting(false);
    }
  };

  const formats = [
    { value: "json" as const, icon: Braces, hint: t.exportPage.jsonHint },
    {
      value: "csv" as const,
      icon: FileSpreadsheet,
      hint: t.exportPage.csvHint,
    },
  ];

  const textField = (key: TextFilter, label: string, placeholder: string) => (
    <Field id={`export-${key}`} label={label}>
      <Input
        id={`export-${key}`}
        value={filters[key]}
        onChange={(e) => setFilter(key, e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
      />
    </Field>
  );

  return (
    <>
      <PageHeader
        title={t.exportPage.title}
        description={t.exportPage.subtitle}
      />

      <div className="grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-5">
        <Panel className="xl:col-span-3">
          <PanelHeader title={t.exportPage.format} />
          <PanelBody className="space-y-6">
            <div
              role="radiogroup"
              aria-label={t.exportPage.format}
              className="grid grid-cols-1 gap-3 xs:grid-cols-2"
            >
              {formats.map((option) => {
                const active = exportFormat === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setExportFormat(option.value)}
                    className={cn(
                      "flex items-start gap-3 rounded-lg border p-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--focus)]",
                      active
                        ? "border-brand bg-brand-soft"
                        : "border-line hover:bg-subtle",
                    )}
                  >
                    <span
                      className={cn(
                        "grid size-8 shrink-0 place-items-center rounded-md",
                        active
                          ? "bg-brand text-white dark:text-ink-inverse"
                          : "bg-subtle text-ink-3",
                      )}
                    >
                      <option.icon className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold uppercase text-ink">
                        {option.value}
                      </span>
                      <span className="mt-0.5 block text-xs leading-5 text-ink-3">
                        {option.hint}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            <section className="space-y-3">
              <h3 className="text-[13px] font-semibold text-ink">
                {t.exportPage.whoTitle}
              </h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {textField("user_id", t.common.userId, t.common.allUsers)}
                {textField("agent_id", t.common.agentId, t.common.allAgents)}
                <Field id="export-category" label={t.common.category}>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger id="export-category">
                      <SelectValue placeholder={t.common.allCategories} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_CATEGORIES}>
                        {t.common.allCategories}
                      </SelectItem>
                      {categories.map((c) => (
                        <SelectItem key={c.id} value={c.name}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </section>

            <section className="space-y-3">
              <div>
                <h3 className="text-[13px] font-semibold text-ink">
                  {t.exportPage.sourceTitle}
                </h3>
                <p className="mt-0.5 text-xs text-ink-3">
                  {t.exportPage.sourceHint}
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {textField(
                  "project",
                  t.source.project,
                  t.exportPage.projectPlaceholder,
                )}
                {textField(
                  "device",
                  t.source.device,
                  t.exportPage.devicePlaceholder,
                )}
                {textField(
                  "agent",
                  t.source.agent,
                  t.exportPage.agentPlaceholder,
                )}
              </div>
            </section>
          </PanelBody>
          <PanelFooter className="sm:justify-end">
            <Button
              onClick={handleExport}
              disabled={isExporting}
              className="w-full sm:w-auto"
            >
              {isExporting ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Download aria-hidden />
              )}
              {isExporting ? t.exportPage.exporting : t.exportPage.export}
            </Button>
          </PanelFooter>
        </Panel>

        <div className="grid min-w-0 content-start gap-4 sm:gap-6 xl:col-span-2">
          <ImportPanel />
          <Panel>
            <PanelHeader title={t.exportPage.sampleOutput} />
            <pre className="scrollbar-thin overflow-x-auto bg-sunken p-4 font-mono text-xs leading-5 text-ink-2 [contain:inline-size] sm:p-5">
              {SAMPLES[exportFormat]}
            </pre>
          </Panel>
        </div>

        {isAdmin && (
          <div className="min-w-0 xl:col-span-3">
            <ExactTransferPanel />
          </div>
        )}
      </div>
    </>
  );
}
