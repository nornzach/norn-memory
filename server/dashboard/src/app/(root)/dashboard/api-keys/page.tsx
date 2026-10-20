"use client";

import { FormEvent, useState } from "react";
import { format } from "date-fns";
import {
  Eye,
  KeyRound,
  Loader2,
  Pencil,
  PlugZap,
  Plus,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CopyButton } from "@/components/misc/copy-button";
import { Column, DataTable } from "@/components/shared/data-table";
import { TableSkeleton } from "@/components/shared/table-skeleton";
import { ErrorBanner } from "@/components/shared/error-banner";
import { Field } from "@/components/shared/field";
import { IdText, PageHeader, Panel } from "@/components/shared/page";
import { EmptyState } from "@/components/self-hosted/empty-state";
import DeleteConfirmationModal from "@/components/ui/delete-confirmation-modal";
import { AgentSetupDialog } from "@/components/self-hosted/agent-setup-dialog";
import { toast } from "@/components/ui/use-toast";
import { getErrorMessage } from "@/lib/error-message";
import { cn } from "@/lib/utils";
import { api } from "@/utils/api";
import { API_KEY_ENDPOINTS, CATEGORY_ENDPOINTS } from "@/utils/api-endpoints";
import { useApiQuery } from "@/hooks/use-api-query";
import {
  ApiKey,
  ApiKeyAccess,
  ApiKeyCreateResponse,
  ApiKeyScopes,
  ApiKeySecret,
  Category,
} from "@/types/api";
import { useI18n } from "@/i18n/provider";

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
  const [labelError, setLabelError] = useState("");
  const [newAccess, setNewAccess] = useState<ApiKeyAccess>("read_write");
  const [newIds, setNewIds] = useState<Record<IdField, string>>(EMPTY_IDS);
  const [newCategories, setNewCategories] = useState<string[]>([]);
  const [newKey, setNewKey] = useState("");
  const [newKeyId, setNewKeyId] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingKey, setEditingKey] = useState<ApiKey | null>(null);
  const [keyToRevoke, setKeyToRevoke] = useState<ApiKey | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupKeyId, setSetupKeyId] = useState("");
  const [shownKey, setShownKey] = useState<{
    row: ApiKey;
    key: string;
  } | null>(null);
  const [revealing, setRevealing] = useState("");
  const { t, dateLocale } = useI18n();

  const {
    data: keys = [],
    isLoading,
    error,
    refetch,
  } = useApiQuery<ApiKey[]>(
    async () => (await api.get<ApiKey[]>(API_KEY_ENDPOINTS.BASE)).data ?? [],
    { errorToast: t.apiKeys.loadFailed, initialData: [] },
  );

  const { data: categories = [] } = useApiQuery<Category[]>(
    async () => (await api.get<Category[]>(CATEGORY_ENDPOINTS.BASE)).data ?? [],
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

  const resetCreate = () => {
    setNewKey("");
    setNewKeyId("");
    setNewLabel("");
    setLabelError("");
    setNewAccess("read_write");
    setNewIds(EMPTY_IDS);
    setNewCategories([]);
    setEditingKey(null);
  };

  const openEdit = (row: ApiKey) => {
    setEditingKey(row);
    setNewKey("");
    setNewLabel(row.label);
    setLabelError("");
    setNewAccess(row.access);
    setNewIds({
      user_ids: row.user_ids.join(", "),
      agent_ids: row.agent_ids.join(", "),
      run_ids: row.run_ids.join(", "),
    });
    setNewCategories(row.categories);
    setCreateOpen(true);
  };

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    if (!newLabel.trim()) {
      setLabelError(t.apiKeys.labelRequired);
      return;
    }
    setCreating(true);
    try {
      const scopes: ApiKeyScopes = {
        access: newAccess,
        user_ids: parseList(newIds.user_ids),
        agent_ids: parseList(newIds.agent_ids),
        run_ids: parseList(newIds.run_ids),
        categories: newCategories,
      };
      if (editingKey) {
        await api.put(API_KEY_ENDPOINTS.BY_ID(editingKey.id), {
          label: newLabel.trim(),
          ...scopes,
        });
        toast({ title: t.apiKeys.updated, variant: "success" });
        setCreateOpen(false);
        resetCreate();
        void refetch();
        return;
      }
      const res = await api.post<ApiKeyCreateResponse>(API_KEY_ENDPOINTS.BASE, {
        label: newLabel.trim(),
        ...scopes,
      });
      setNewKey(res.data.key);
      setNewKeyId(res.data.id);
      void refetch();
    } catch (err) {
      toast({
        title: editingKey ? t.apiKeys.updateFailed : t.apiKeys.createFailed,
        description: getErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async () => {
    if (!keyToRevoke) return;
    try {
      await api.delete(API_KEY_ENDPOINTS.BY_ID(keyToRevoke.id));
      toast({ title: t.apiKeys.revoked, variant: "success" });
      setKeyToRevoke(null);
      void refetch();
    } catch (err) {
      toast({
        title: t.apiKeys.revokeFailed,
        description: getErrorMessage(err),
        variant: "destructive",
      });
    }
  };

  const handleDialogChange = (open: boolean) => {
    if (creating) return;
    if (!open) resetCreate();
    setCreateOpen(open);
  };

  const openAgentSetup = (keyId = "") => {
    setSetupKeyId(keyId);
    setSetupOpen(true);
  };

  const showKey = async (row: ApiKey) => {
    setRevealing(row.id);
    try {
      const res = await api.get<ApiKeySecret>(API_KEY_ENDPOINTS.KEY(row.id));
      setShownKey({ row, key: res.data.key });
    } catch (err) {
      toast({
        title: t.apiKeys.showFailed,
        description: getErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setRevealing("");
    }
  };

  const date = (value: string | null) =>
    value
      ? format(new Date(value), t.common.dateFormat, { locale: dateLocale })
      : t.common.never;

  const scopeChips = (row: ApiKey) => {
    const parts = [
      ...row.user_ids.map((v) => `${t.apiKeys.scopeUser}: ${v}`),
      ...row.agent_ids.map((v) => `${t.apiKeys.scopeAgent}: ${v}`),
      ...row.run_ids.map((v) => `${t.apiKeys.scopeRun}: ${v}`),
      ...row.categories.map((v) => `${t.apiKeys.scopeCategory}: ${v}`),
    ];
    if (parts.length === 0) {
      return <span className="text-sm text-ink-3">{t.apiKeys.scopeAll}</span>;
    }
    return (
      <div className="flex flex-wrap gap-1">
        {parts.map((part) => (
          <Badge key={part} variant="outline" className="font-mono">
            {part}
          </Badge>
        ))}
      </div>
    );
  };

  const accessBadge = (value: ApiKeyAccess) => (
    <Badge variant={value === "read" ? "secondary" : "brand"}>
      {value === "read" ? t.apiKeys.accessRead : t.apiKeys.accessReadWrite}
    </Badge>
  );

  const rowActions = (row: ApiKey) => (
    <div className="flex justify-end gap-1">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => void showKey(row)}
        disabled={!row.retrievable || revealing === row.id}
        aria-label={t.apiKeys.showLabel(row.label)}
        title={row.retrievable ? t.apiKeys.showKey : t.apiKeys.notRetrievable}
      >
        {revealing === row.id ? (
          <Loader2 className="animate-spin" aria-hidden />
        ) : (
          <Eye aria-hidden />
        )}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => openAgentSetup(row.id)}
        disabled={!row.retrievable}
        aria-label={t.apiKeys.connectLabel(row.label)}
        title={
          row.retrievable ? t.agentSetup.useWithAgent : t.apiKeys.notRetrievable
        }
      >
        <PlugZap aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => openEdit(row)}
        aria-label={t.apiKeys.editLabel(row.label)}
        title={t.common.edit}
      >
        <Pencil aria-hidden />
      </Button>
      <Button
        variant="destructive-ghost"
        size="icon-sm"
        onClick={() => setKeyToRevoke(row)}
        aria-label={t.apiKeys.revokeLabel(row.label)}
        title={t.apiKeys.revoke}
      >
        <Trash2 aria-hidden />
      </Button>
    </div>
  );

  const columns: Column<ApiKey>[] = [
    {
      key: "label",
      label: t.apiKeys.columns.label,
      render: (value, row) => (
        <div className="min-w-0">
          <p className="font-medium text-ink">{String(value)}</p>
          <div className="mt-1 flex items-center gap-2">
            <IdText>{row.key_prefix}…</IdText>
            {accessBadge(row.access)}
          </div>
        </div>
      ),
    },
    {
      key: "user_ids",
      label: t.apiKeys.columns.scope,
      wrap: true,
      hideBelow: "lg",
      className: "min-w-[150px]",
      render: (_, row) => scopeChips(row),
    },
    {
      key: "created_at",
      label: t.apiKeys.columns.created,
      hideBelow: "xl",
      className: "text-ink-2",
      render: (value) => date(value as string),
    },
    {
      key: "last_used_at",
      label: t.apiKeys.columns.lastUsed,
      className: "text-ink-2",
      render: (value) => date(value as string | null),
    },
    {
      key: "id",
      label: t.common.actions,
      headerVariant: "check",
      align: "right",
      isAction: true,
      render: (_, row) => rowActions(row),
    },
  ];

  return (
    <>
      <PageHeader
        title={t.apiKeys.title}
        description={t.apiKeys.subtitle}
        actions={
          <>
            <Button variant="outline" onClick={() => openAgentSetup()}>
              <PlugZap aria-hidden />
              {t.agentSetup.button}
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus aria-hidden />
              {t.apiKeys.createKey}
            </Button>
          </>
        }
      />

      {error && !isLoading && (
        <ErrorBanner message={error} onRetry={() => void refetch()} />
      )}

      <Panel>
        {isLoading ? (
          <TableSkeleton rows={3} columns={6} />
        ) : keys.length === 0 ? (
          <EmptyState
            icon={KeyRound}
            title={t.apiKeys.emptyTitle}
            description={t.apiKeys.emptyDescription}
          >
            <Button onClick={() => setCreateOpen(true)}>
              <Plus aria-hidden />
              {t.apiKeys.createKey}
            </Button>
          </EmptyState>
        ) : (
          <DataTable
            data={keys}
            columns={columns}
            caption={t.apiKeys.title}
            getRowKey={(row) => row.id}
            renderMobileCard={(row) => (
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{row.label}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <IdText>{row.key_prefix}…</IdText>
                      {accessBadge(row.access)}
                    </div>
                  </div>
                  {rowActions(row)}
                </div>
                {scopeChips(row)}
                <p className="text-xs text-ink-3">
                  {t.apiKeys.columns.lastUsed}: {date(row.last_used_at)}
                </p>
              </div>
            )}
          />
        )}
      </Panel>

      <Dialog open={createOpen} onOpenChange={handleDialogChange}>
        <DialogContent className="max-w-xl">
          {newKey ? (
            <div className="grid gap-5">
              <DialogHeader>
                <DialogTitle>{t.apiKeys.keyCreated}</DialogTitle>
                <DialogDescription>
                  {t.apiKeys.keyCreatedDescription}
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-center gap-2 rounded-lg border border-line bg-sunken p-2 pl-3">
                <code className="min-w-0 flex-1 break-all font-mono text-[13px] text-ink">
                  {newKey}
                </code>
                <CopyButton
                  text={newKey}
                  label={t.common.copyValue(t.apiKeys.yourKey)}
                  variant="outline"
                  showLabel
                />
              </div>
              <p className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
                <ShieldAlert className="mt-px size-4 shrink-0" aria-hidden />
                {t.apiKeys.keyAccessNote}
              </p>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    const keyId = newKeyId;
                    handleDialogChange(false);
                    openAgentSetup(keyId);
                  }}
                >
                  <PlugZap aria-hidden />
                  {t.agentSetup.useWithAgent}
                </Button>
                <Button onClick={() => handleDialogChange(false)}>
                  {t.common.done}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={handleCreate} className="grid gap-5" noValidate>
              <DialogHeader>
                <DialogTitle>
                  {editingKey ? t.apiKeys.editTitle : t.apiKeys.createTitle}
                </DialogTitle>
                <DialogDescription>
                  {editingKey
                    ? t.apiKeys.editDescription
                    : t.apiKeys.createDescription}
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  id="api-key-label"
                  label={t.apiKeys.label}
                  error={labelError}
                >
                  <Input
                    id="api-key-label"
                    value={newLabel}
                    autoFocus
                    onChange={(e) => {
                      setNewLabel(e.target.value);
                      setLabelError("");
                    }}
                    placeholder={t.apiKeys.labelPlaceholder}
                    aria-invalid={Boolean(labelError)}
                  />
                </Field>
                <Field label={t.apiKeys.access} hint={t.apiKeys.accessHint}>
                  <Segmented
                    label={t.apiKeys.access}
                    value={newAccess}
                    onChange={setNewAccess}
                    className="w-full"
                    options={[
                      {
                        value: "read_write",
                        label: t.apiKeys.accessReadWrite,
                      },
                      { value: "read", label: t.apiKeys.accessRead },
                    ]}
                  />
                </Field>
              </div>

              <fieldset className="space-y-3 rounded-lg border border-line p-4">
                <legend className="px-1 text-[13px] font-semibold text-ink">
                  {t.apiKeys.scope}
                </legend>
                <p className="text-xs leading-5 text-ink-3">
                  {t.apiKeys.scopeHint}
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {ID_FIELDS.map((field) => (
                    <Field
                      key={field}
                      id={`api-key-${field}`}
                      label={idLabels[field]}
                    >
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
                        autoComplete="off"
                      />
                    </Field>
                  ))}
                </div>
                <Field
                  label={t.apiKeys.categories}
                  hint={t.apiKeys.categoriesHint}
                >
                  {categories.length === 0 ? (
                    <p className="text-xs text-ink-3">
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
                              "h-7 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--focus)]",
                              selected
                                ? "border-brand bg-brand-soft text-brand-text"
                                : "border-line bg-panel text-ink-2 hover:bg-subtle",
                            )}
                          >
                            {c.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </Field>
              </fieldset>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleDialogChange(false)}
                  disabled={creating}
                >
                  {t.common.cancel}
                </Button>
                <Button type="submit" disabled={creating}>
                  {creating && <Loader2 className="animate-spin" aria-hidden />}
                  {editingKey ? t.common.save : t.common.create}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!shownKey}
        onOpenChange={(open) => {
          if (!open) setShownKey(null);
        }}
      >
        <DialogContent className="max-w-xl">
          {shownKey && (
            <div className="grid gap-5">
              <DialogHeader>
                <DialogTitle>{shownKey.row.label}</DialogTitle>
                <DialogDescription>
                  {t.apiKeys.shownDescription}
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-center gap-2 rounded-lg border border-line bg-sunken p-2 pl-3">
                <code className="min-w-0 flex-1 break-all font-mono text-[13px] text-ink">
                  {shownKey.key}
                </code>
                <CopyButton
                  text={shownKey.key}
                  label={t.common.copyValue(t.apiKeys.yourKey)}
                  variant="outline"
                  showLabel
                />
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    const keyId = shownKey.row.id;
                    setShownKey(null);
                    openAgentSetup(keyId);
                  }}
                >
                  <PlugZap aria-hidden />
                  {t.agentSetup.useWithAgent}
                </Button>
                <Button onClick={() => setShownKey(null)}>
                  {t.common.done}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AgentSetupDialog
        open={setupOpen}
        onOpenChange={setSetupOpen}
        initialKeyId={setupKeyId}
      />

      <DeleteConfirmationModal
        isOpen={!!keyToRevoke}
        onClose={() => setKeyToRevoke(null)}
        onConfirm={handleRevoke}
        title={t.apiKeys.revokeTitle}
        description={t.apiKeys.revokeDescription}
        itemName={keyToRevoke?.label ?? ""}
        confirmButtonText={t.apiKeys.revoke}
        requireTyping
      />
    </>
  );
}
