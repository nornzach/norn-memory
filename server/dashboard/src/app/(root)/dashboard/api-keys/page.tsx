"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { DataTable } from "@/components/shared/data-table";
import { TableSkeleton } from "@/components/shared/table-skeleton";
import { EmptyState } from "@/components/self-hosted/empty-state";
import DeleteConfirmationModal from "@/components/ui/delete-confirmation-modal";
import { api } from "@/utils/api";
import { API_KEY_ENDPOINTS, CATEGORY_ENDPOINTS } from "@/utils/api-endpoints";
import { toast } from "@/components/ui/use-toast";
import { Plus, Copy, Check, Trash2, PlugZap } from "lucide-react";
import { CopyToClipboard } from "react-copy-to-clipboard";
import { format } from "date-fns";
import { getErrorMessage } from "@/lib/error-message";
import { cn } from "@/lib/utils";
import { useApiQuery } from "@/hooks/use-api-query";
import {
  ApiKey,
  ApiKeyAccess,
  ApiKeyCreateResponse,
  ApiKeyScopes,
  Category,
} from "@/types/api";
import { useI18n } from "@/i18n/provider";
import { AgentSetupDialog } from "@/components/self-hosted/agent-setup-dialog";

type IdField = "user_ids" | "agent_ids" | "run_ids";

const ID_FIELDS: IdField[] = ["user_ids", "agent_ids", "run_ids"];

const EMPTY_IDS: Record<IdField, string> = {
  user_ids: "",
  agent_ids: "",
  run_ids: "",
};

function parseList(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  );
}

export default function ApiKeysPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newAccess, setNewAccess] = useState<ApiKeyAccess>("read_write");
  const [newIds, setNewIds] = useState<Record<IdField, string>>(EMPTY_IDS);
  const [newCategories, setNewCategories] = useState<string[]>([]);
  const [newKey, setNewKey] = useState("");
  const [copied, setCopied] = useState(false);
  const [keyToRevoke, setKeyToRevoke] = useState<ApiKey | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupKey, setSetupKey] = useState("");
  const [setupUserId, setSetupUserId] = useState("");
  const { t, dateLocale } = useI18n();

  const {
    data: keys = [],
    isLoading,
    refetch,
  } = useApiQuery<ApiKey[]>(
    async () => {
      const res = await api.get<ApiKey[]>(API_KEY_ENDPOINTS.BASE);
      return res.data ?? [];
    },
    { errorToast: t.apiKeys.loadFailed, initialData: [] },
  );

  const { data: categories = [] } = useApiQuery<Category[]>(
    async () => {
      const res = await api.get<Category[]>(CATEGORY_ENDPOINTS.BASE);
      return res.data ?? [];
    },
    { initialData: [] },
  );

  const idLabels: Record<IdField, string> = {
    user_ids: t.apiKeys.userIds,
    agent_ids: t.apiKeys.agentIds,
    run_ids: t.apiKeys.runIds,
  };

  const toggleCategory = (name: string) =>
    setNewCategories((current) =>
      current.includes(name)
        ? current.filter((c) => c !== name)
        : [...current, name],
    );

  const handleCreate = async () => {
    try {
      const scopes: ApiKeyScopes = {
        access: newAccess,
        user_ids: parseList(newIds.user_ids),
        agent_ids: parseList(newIds.agent_ids),
        run_ids: parseList(newIds.run_ids),
        categories: newCategories,
      };
      const res = await api.post<ApiKeyCreateResponse>(API_KEY_ENDPOINTS.BASE, {
        label: newLabel,
        ...scopes,
      });
      setNewKey(res.data.key);
      void refetch();
    } catch (error) {
      toast({
        title: t.apiKeys.createFailed,
        description: getErrorMessage(error),
        variant: "destructive",
      });
    }
  };

  const handleRevoke = async () => {
    if (!keyToRevoke) return;
    try {
      await api.delete(API_KEY_ENDPOINTS.BY_ID(keyToRevoke.id));
      toast({ title: t.apiKeys.revoked, variant: "success" });
      setKeyToRevoke(null);
      void refetch();
    } catch (error) {
      toast({
        title: t.apiKeys.revokeFailed,
        description: getErrorMessage(error),
        variant: "destructive",
      });
    }
  };

  const handleDialogClose = (open: boolean) => {
    if (!open) {
      setNewKey("");
      setNewLabel("");
      setNewAccess("read_write");
      setNewIds(EMPTY_IDS);
      setNewCategories([]);
      setCopied(false);
    }
    setCreateOpen(open);
  };

  const openAgentSetup = (key = "", userId = "") => {
    setSetupKey(key);
    setSetupUserId(userId);
    setSetupOpen(true);
  };

  const handleSetupClose = (open: boolean) => {
    // Forget the key once the dialog closes; it was only kept to prefill the prompt.
    if (!open) setSetupKey("");
    setSetupOpen(open);
  };

  const columns = [
    {
      key: "label" as keyof ApiKey,
      label: t.apiKeys.columns.label,
      width: 150,
    },
    {
      key: "key_prefix" as keyof ApiKey,
      label: t.apiKeys.columns.key,
      width: 120,
      render: (value: string) => (
        <code className="text-xs font-mono">{value}...</code>
      ),
    },
    {
      key: "access" as keyof ApiKey,
      label: t.apiKeys.columns.access,
      width: 100,
      render: (value: ApiKeyAccess) =>
        value === "read" ? t.apiKeys.accessRead : t.apiKeys.accessReadWrite,
    },
    {
      key: "user_ids" as keyof ApiKey,
      label: t.apiKeys.columns.scope,
      width: 220,
      render: (_: string[], row: ApiKey) => {
        const parts = [
          ...row.user_ids.map((v) => `${t.apiKeys.scopeUser}: ${v}`),
          ...row.agent_ids.map((v) => `${t.apiKeys.scopeAgent}: ${v}`),
          ...row.run_ids.map((v) => `${t.apiKeys.scopeRun}: ${v}`),
          ...row.categories.map((v) => `${t.apiKeys.scopeCategory}: ${v}`),
        ];
        if (parts.length === 0) {
          return (
            <span className="text-onSurface-default-tertiary">
              {t.apiKeys.scopeAll}
            </span>
          );
        }
        return (
          <div className="flex flex-wrap gap-1">
            {parts.map((part) => (
              <code
                key={part}
                className="text-xs font-mono rounded bg-surface-default-secondary px-1.5 py-0.5"
              >
                {part}
              </code>
            ))}
          </div>
        );
      },
    },
    {
      key: "created_at" as keyof ApiKey,
      label: t.apiKeys.columns.created,
      width: 120,
      render: (value: string) =>
        format(new Date(value), t.common.dateFormat, { locale: dateLocale }),
    },
    {
      key: "last_used_at" as keyof ApiKey,
      label: t.apiKeys.columns.lastUsed,
      width: 120,
      render: (value: string | null) =>
        value
          ? format(new Date(value), t.common.dateFormat, {
              locale: dateLocale,
            })
          : t.common.never,
    },
    {
      key: "id" as keyof ApiKey,
      label: "",
      width: 40,
      render: (_: string, row: ApiKey) => (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setKeyToRevoke(row)}
          aria-label={t.apiKeys.revokeLabel(row.label)}
          className="size-7"
        >
          <Trash2 className="size-3.5 text-onSurface-danger-primary" />
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold font-fustat">{t.apiKeys.title}</h1>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => openAgentSetup()}>
            <PlugZap className="size-4 mr-1" /> {t.agentSetup.button}
          </Button>
          <Dialog open={createOpen} onOpenChange={handleDialogClose}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="size-4 mr-1" /> {t.apiKeys.createKey}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t.apiKeys.createTitle}</DialogTitle>
              </DialogHeader>
              {!newKey ? (
                <div className="space-y-4 mt-2">
                  <div className="space-y-2">
                    <Label htmlFor="api-key-label">{t.apiKeys.label}</Label>
                    <Input
                      id="api-key-label"
                      value={newLabel}
                      onChange={(e) => setNewLabel(e.target.value)}
                      placeholder={t.apiKeys.labelPlaceholder}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="api-key-access">{t.apiKeys.access}</Label>
                    <Select
                      value={newAccess}
                      onValueChange={(v) => setNewAccess(v as ApiKeyAccess)}
                    >
                      <SelectTrigger id="api-key-access">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="read_write">
                          {t.apiKeys.accessReadWrite}
                        </SelectItem>
                        <SelectItem value="read">
                          {t.apiKeys.accessRead}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-onSurface-default-tertiary">
                      {t.apiKeys.accessHint}
                    </p>
                  </div>
                  <fieldset className="space-y-3">
                    <legend className="text-sm font-medium">
                      {t.apiKeys.scope}
                    </legend>
                    <p className="text-xs text-onSurface-default-tertiary">
                      {t.apiKeys.scopeHint}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {ID_FIELDS.map((field) => (
                        <div key={field} className="space-y-1">
                          <Label htmlFor={`api-key-${field}`}>
                            {idLabels[field]}
                          </Label>
                          <Input
                            id={`api-key-${field}`}
                            value={newIds[field]}
                            onChange={(e) =>
                              setNewIds((ids) => ({
                                ...ids,
                                [field]: e.target.value,
                              }))
                            }
                            placeholder={t.apiKeys.idsPlaceholder}
                          />
                        </div>
                      ))}
                    </div>
                    <div className="space-y-1">
                      <Label>{t.apiKeys.categories}</Label>
                      {categories.length === 0 ? (
                        <p className="text-xs text-onSurface-default-tertiary">
                          {t.apiKeys.noCategories}
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {categories.map((c) => {
                            const selected = newCategories.includes(c.name);
                            return (
                              <button
                                key={c.id}
                                type="button"
                                aria-pressed={selected}
                                onClick={() => toggleCategory(c.name)}
                                className={cn(
                                  "rounded-md border px-2 py-0.5 text-xs transition-colors",
                                  selected
                                    ? "border-memPurple-500 bg-memPurple-500 text-white"
                                    : "border-memBorder-primary text-onSurface-default-secondary hover:bg-surface-default-secondary",
                                )}
                              >
                                {c.name}
                              </button>
                            );
                          })}
                        </div>
                      )}
                      <p className="text-xs text-onSurface-default-tertiary">
                        {t.apiKeys.categoriesHint}
                      </p>
                    </div>
                  </fieldset>
                  <Button
                    onClick={handleCreate}
                    disabled={!newLabel}
                    className="w-full"
                  >
                    {t.common.create}
                  </Button>
                </div>
              ) : (
                <div className="space-y-4 mt-2">
                  <div className="space-y-2">
                    <Label htmlFor="api-key-new">{t.apiKeys.yourKey}</Label>
                    <div className="flex gap-2">
                      <Input
                        id="api-key-new"
                        value={newKey}
                        readOnly
                        className="font-mono text-sm"
                      />
                      <CopyToClipboard
                        text={newKey}
                        onCopy={() => {
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        }}
                      >
                        <Button variant="outline" size="icon">
                          {copied ? (
                            <Check className="size-4" />
                          ) : (
                            <Copy className="size-4" />
                          )}
                        </Button>
                      </CopyToClipboard>
                    </div>
                    <p className="text-xs text-onSurface-danger-primary">
                      {t.apiKeys.saveKeyWarning}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      const userId = parseList(newIds.user_ids)[0] ?? "";
                      const key = newKey;
                      handleDialogClose(false);
                      openAgentSetup(key, userId);
                    }}
                  >
                    <PlugZap className="size-4 mr-1" />
                    {t.agentSetup.useWithAgent}
                  </Button>
                  <Button
                    onClick={() => handleDialogClose(false)}
                    className="w-full"
                  >
                    {t.common.done}
                  </Button>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <AgentSetupDialog
        open={setupOpen}
        onOpenChange={handleSetupClose}
        initialKey={setupKey}
        initialUserId={setupUserId}
      />

      {isLoading ? (
        <TableSkeleton rows={3} columns={6} />
      ) : keys.length === 0 ? (
        <EmptyState
          title={t.apiKeys.emptyTitle}
          description={t.apiKeys.emptyDescription}
        />
      ) : (
        <Card className="border-memBorder-primary overflow-hidden">
          <DataTable
            data={keys}
            columns={columns}
            getRowKey={(row) => row.id}
          />
        </Card>
      )}

      <DeleteConfirmationModal
        isOpen={!!keyToRevoke}
        onClose={() => setKeyToRevoke(null)}
        onConfirm={handleRevoke}
        title={t.apiKeys.revokeTitle}
        description={t.apiKeys.revokeDescription}
        itemName={keyToRevoke?.label ?? ""}
        confirmButtonText={t.apiKeys.revoke}
      />
    </div>
  );
}
