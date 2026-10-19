"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { format as formatDate } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/use-toast";
import { getErrorMessage } from "@/lib/error-message";
import { cn } from "@/lib/utils";
import { api } from "@/utils/api";
import { CATEGORY_ENDPOINTS, EXPORT_ENDPOINTS } from "@/utils/api-endpoints";
import { useApiQuery } from "@/hooks/use-api-query";
import { Category } from "@/types/api";
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

export default function ExportPage() {
  const [exportFormat, setExportFormat] = useState<ExportFormat>("json");
  const [userId, setUserId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [category, setCategory] = useState(ALL_CATEGORIES);
  const [isExporting, setIsExporting] = useState(false);
  const { t } = useI18n();

  const { data: categories = [] } = useApiQuery<Category[]>(
    async () => {
      const res = await api.get<Category[]>(CATEGORY_ENDPOINTS.BASE);
      return res.data ?? [];
    },
    { initialData: [] },
  );

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const params: Record<string, string> = { format: exportFormat };
      if (userId.trim()) params.user_id = userId.trim();
      if (agentId.trim()) params.agent_id = agentId.trim();
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

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold font-fustat">
          {t.exportPage.title}
        </h1>
        <p className="text-sm text-onSurface-default-secondary mt-1">
          {t.exportPage.subtitle}
        </p>
      </div>

      <Card className="border-memBorder-primary">
        <CardContent className="p-6 space-y-5">
          <div className="space-y-2">
            <Label>{t.exportPage.format}</Label>
            <div
              role="radiogroup"
              aria-label={t.exportPage.format}
              className="flex gap-2"
            >
              {(["json", "csv"] as const).map((fmt) => (
                <Button
                  key={fmt}
                  variant="outline"
                  size="sm"
                  role="radio"
                  aria-checked={exportFormat === fmt}
                  onClick={() => setExportFormat(fmt)}
                  className={cn(
                    "uppercase",
                    exportFormat === fmt &&
                      "border-memPurple-500 bg-surface-default-brand",
                  )}
                >
                  {fmt}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="export-user">{t.common.userId}</Label>
              <Input
                id="export-user"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder={t.common.allUsers}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="export-agent">{t.common.agentId}</Label>
              <Input
                id="export-agent"
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                placeholder={t.common.allAgents}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="export-category">{t.common.category}</Label>
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
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t.exportPage.sampleOutput}</Label>
            <pre className="text-xs text-onSurface-default-secondary font-mono whitespace-pre overflow-x-auto [contain:inline-size] bg-surface-default-secondary rounded-md p-3">
              {SAMPLES[exportFormat]}
            </pre>
          </div>

          <Button onClick={handleExport} disabled={isExporting}>
            <Download className="size-4 mr-1" />
            {isExporting ? t.exportPage.exporting : t.exportPage.export}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
