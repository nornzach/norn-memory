"use client";

import { FormEvent, useState } from "react";
import {
  Loader2,
  Pencil,
  Plus,
  Send,
  ShieldAlert,
  Trash2,
  Webhook as WebhookIcon,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
import { PageHeader, Panel } from "@/components/shared/page";
import { EmptyState } from "@/components/self-hosted/empty-state";
import DeleteConfirmationModal from "@/components/ui/delete-confirmation-modal";
import { toast } from "@/components/ui/use-toast";
import { getErrorMessage } from "@/lib/error-message";
import { getStatusClassName } from "@/lib/http-badges";
import { api } from "@/utils/api";
import { WEBHOOK_ENDPOINTS } from "@/utils/api-endpoints";
import { useApiQuery } from "@/hooks/use-api-query";
import {
  WEBHOOK_EVENTS,
  Webhook,
  WebhookCreateResponse,
  WebhookEvent,
  WebhookTestResponse,
} from "@/types/api";
import { useI18n } from "@/i18n/provider";

const DEFAULT_EVENTS: WebhookEvent[] = [
  "memory.created",
  "memory.updated",
  "memory.deleted",
];

type EditorState = { mode: "create" } | { mode: "edit"; webhook: Webhook };

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export default function WebhooksPage() {
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<WebhookEvent[]>(DEFAULT_EVENTS);
  const [formError, setFormError] = useState<{ url?: string; events?: string }>(
    {},
  );
  const [newSecret, setNewSecret] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [webhookToDelete, setWebhookToDelete] = useState<Webhook | null>(null);
  const { t, dateLocale } = useI18n();

  const {
    data: webhooks = [],
    isLoading,
    error,
    refetch,
  } = useApiQuery<Webhook[]>(
    async () => (await api.get<Webhook[]>(WEBHOOK_ENDPOINTS.BASE)).data ?? [],
    { errorToast: t.webhooks.loadFailed, initialData: [] },
  );

  const openEditor = (state: EditorState) => {
    setEditor(state);
    setUrl(state.mode === "edit" ? state.webhook.url : "");
    setEvents(state.mode === "edit" ? state.webhook.events : DEFAULT_EVENTS);
    setFormError({});
    setNewSecret("");
  };

  const closeEditor = () => {
    if (isSaving) return;
    setEditor(null);
    setNewSecret("");
  };

  const toggleEvent = (event: WebhookEvent, checked: boolean) => {
    setFormError((e) => ({ ...e, events: undefined }));
    setEvents((current) =>
      checked ? [...current, event] : current.filter((e) => e !== event),
    );
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!editor) return;
    const next: typeof formError = {};
    if (!isHttpUrl(url.trim())) next.url = t.webhooks.urlInvalid;
    if (events.length === 0) next.events = t.webhooks.eventsRequired;
    setFormError(next);
    if (next.url || next.events) return;

    setIsSaving(true);
    try {
      if (editor.mode === "create") {
        const res = await api.post<WebhookCreateResponse>(
          WEBHOOK_ENDPOINTS.BASE,
          { url: url.trim(), events },
        );
        setNewSecret(res.data.secret);
      } else {
        await api.patch(WEBHOOK_ENDPOINTS.BY_ID(editor.webhook.id), {
          url: url.trim(),
          events,
        });
        toast({ title: t.webhooks.saved, variant: "success" });
        setEditor(null);
      }
      void refetch();
    } catch (err) {
      toast({
        title:
          editor.mode === "create"
            ? t.webhooks.createFailed
            : t.webhooks.updateFailed,
        description: getErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleActive = async (webhook: Webhook, isActive: boolean) => {
    setTogglingId(webhook.id);
    try {
      await api.patch(WEBHOOK_ENDPOINTS.BY_ID(webhook.id), {
        is_active: isActive,
      });
      await refetch();
    } catch (err) {
      toast({
        title: t.webhooks.updateFailed,
        description: getErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setTogglingId(null);
    }
  };

  const handleTest = async (webhook: Webhook) => {
    setTestingId(webhook.id);
    try {
      const res = await api.post<WebhookTestResponse>(
        WEBHOOK_ENDPOINTS.TEST(webhook.id),
      );
      toast(
        res.data.ok
          ? {
              title: t.webhooks.testDelivered,
              description: t.webhooks.testDeliveredDescription(
                res.data.status_code,
              ),
              variant: "success",
            }
          : {
              title: t.webhooks.testFailed,
              description: res.data.error ?? t.webhooks.noResponse,
              variant: "destructive",
            },
      );
      void refetch();
    } catch (err) {
      toast({
        title: t.webhooks.sendTestFailed,
        description: getErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = async () => {
    if (!webhookToDelete) return;
    try {
      await api.delete(WEBHOOK_ENDPOINTS.BY_ID(webhookToDelete.id));
      toast({ title: t.webhooks.deleted, variant: "success" });
      setWebhookToDelete(null);
      void refetch();
    } catch (err) {
      toast({
        title: t.webhooks.deleteFailed,
        description: getErrorMessage(err),
        variant: "destructive",
      });
    }
  };

  const lastDelivery = (row: Webhook) => {
    if (!row.last_delivery_at) {
      return <span className="text-xs text-ink-3">{t.common.never}</span>;
    }
    return (
      <div
        className="flex items-center gap-2"
        title={row.last_error ?? undefined}
      >
        <Badge className={getStatusClassName(row.last_status_code ?? 500)}>
          {row.last_status_code ?? t.webhooks.error}
        </Badge>
        <span className="text-xs text-ink-3">
          {formatDistanceToNow(new Date(row.last_delivery_at), {
            addSuffix: true,
            locale: dateLocale,
          })}
        </span>
      </div>
    );
  };

  const activeSwitch = (row: Webhook) => (
    <Switch
      checked={row.is_active}
      disabled={togglingId === row.id}
      aria-label={t.webhooks.toggleLabel(row.url)}
      onCheckedChange={(checked) => handleToggleActive(row, checked)}
    />
  );

  const rowActions = (row: Webhook) => (
    <div className="flex items-center justify-end gap-1">
      <Button
        variant="ghost"
        size="sm"
        disabled={testingId === row.id}
        onClick={() => handleTest(row)}
        aria-label={t.webhooks.testLabel(row.url)}
      >
        {testingId === row.id ? (
          <Loader2 className="animate-spin" aria-hidden />
        ) : (
          <Send aria-hidden />
        )}
        <span className="hidden xl:inline">{t.webhooks.sendTest}</span>
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => openEditor({ mode: "edit", webhook: row })}
        aria-label={t.webhooks.editLabel(row.url)}
        title={t.webhooks.editLabel(row.url)}
      >
        <Pencil aria-hidden />
      </Button>
      <Button
        variant="destructive-ghost"
        size="icon-sm"
        onClick={() => setWebhookToDelete(row)}
        aria-label={t.webhooks.deleteLabel(row.url)}
        title={t.webhooks.deleteLabel(row.url)}
      >
        <Trash2 aria-hidden />
      </Button>
    </div>
  );

  const eventBadges = (list: WebhookEvent[]) => (
    <div className="flex flex-wrap gap-1">
      {list.map((event) => (
        <Badge
          key={event}
          variant="outline"
          className="font-mono"
          title={t.webhooks.events[event]}
        >
          {event}
        </Badge>
      ))}
    </div>
  );

  const columns: Column<Webhook>[] = [
    {
      key: "url",
      label: t.webhooks.columns.endpoint,
      wrap: true,
      render: (value, row) => (
        <div className="min-w-0">
          <code className="break-all font-mono text-xs text-ink">
            {String(value)}
          </code>
          {!row.is_active && (
            <Badge variant="warning" className="ml-2">
              {t.webhooks.paused}
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: "events",
      label: t.webhooks.columns.events,
      wrap: true,
      hideBelow: "lg",
      render: (value) => eventBadges(value as WebhookEvent[]),
    },
    {
      key: "last_status_code",
      label: t.webhooks.columns.lastDelivery,
      render: (_, row) => lastDelivery(row),
    },
    {
      key: "is_active",
      label: t.webhooks.columns.active,
      isAction: true,
      render: (_, row) => activeSwitch(row),
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
        title={t.webhooks.title}
        description={t.webhooks.subtitle}
        actions={
          <Button onClick={() => openEditor({ mode: "create" })}>
            <Plus aria-hidden />
            {t.webhooks.add}
          </Button>
        }
      />

      {error && !isLoading && (
        <ErrorBanner message={error} onRetry={() => void refetch()} />
      )}

      <Panel>
        {isLoading ? (
          <TableSkeleton rows={3} columns={5} />
        ) : webhooks.length === 0 ? (
          <EmptyState
            icon={WebhookIcon}
            title={t.webhooks.emptyTitle}
            description={t.webhooks.emptyDescription}
          >
            <Button onClick={() => openEditor({ mode: "create" })}>
              <Plus aria-hidden />
              {t.webhooks.add}
            </Button>
          </EmptyState>
        ) : (
          <DataTable
            data={webhooks}
            columns={columns}
            caption={t.webhooks.title}
            getRowKey={(row) => row.id}
            renderMobileCard={(row) => (
              <div className="space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <code className="min-w-0 break-all font-mono text-xs text-ink">
                    {row.url}
                  </code>
                  {activeSwitch(row)}
                </div>
                {eventBadges(row.events)}
                <div className="flex items-center justify-between gap-2">
                  {lastDelivery(row)}
                  {rowActions(row)}
                </div>
              </div>
            )}
          />
        )}
      </Panel>

      <Dialog open={!!editor} onOpenChange={(open) => !open && closeEditor()}>
        <DialogContent className="max-w-lg">
          {newSecret ? (
            <div className="grid gap-5">
              <DialogHeader>
                <DialogTitle>{t.webhooks.signingSecret}</DialogTitle>
                <DialogDescription>{t.webhooks.verifyHint}</DialogDescription>
              </DialogHeader>
              <div className="flex items-center gap-2 rounded-lg border border-line bg-sunken p-2 pl-3">
                <code className="min-w-0 flex-1 break-all font-mono text-[13px] text-ink">
                  {newSecret}
                </code>
                <CopyButton
                  text={newSecret}
                  label={t.common.copyValue(t.webhooks.signingSecret)}
                  variant="outline"
                  showLabel
                />
              </div>
              <p className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
                <ShieldAlert className="mt-px size-4 shrink-0" aria-hidden />
                {t.common.saveSecretWarning}
              </p>
              <DialogFooter>
                <Button onClick={closeEditor}>{t.common.done}</Button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={handleSave} className="grid gap-5" noValidate>
              <DialogHeader>
                <DialogTitle>
                  {editor?.mode === "edit"
                    ? t.webhooks.editTitle
                    : t.webhooks.addTitle}
                </DialogTitle>
                <DialogDescription>
                  {editor?.mode === "edit"
                    ? t.webhooks.editDescription
                    : t.webhooks.addDescription}
                </DialogDescription>
              </DialogHeader>
              <Field
                id="webhook-url"
                label={t.webhooks.endpointUrl}
                error={formError.url}
              >
                <Input
                  id="webhook-url"
                  type="url"
                  inputMode="url"
                  value={url}
                  autoFocus
                  onChange={(e) => {
                    setUrl(e.target.value);
                    setFormError((f) => ({ ...f, url: undefined }));
                  }}
                  placeholder="https://your-app.com/webhooks/norn-m"
                  aria-invalid={Boolean(formError.url)}
                />
              </Field>
              <fieldset className="space-y-2">
                <legend className="mb-2 text-[13px] font-medium text-ink-2">
                  {t.webhooks.eventsLabel}
                </legend>
                <div className="divide-y divide-line overflow-hidden rounded-lg border border-line">
                  {WEBHOOK_EVENTS.map((event) => (
                    <label
                      key={event}
                      className="flex cursor-pointer items-start gap-3 px-3 py-2.5 transition-colors hover:bg-subtle/60"
                    >
                      <Checkbox
                        checked={events.includes(event)}
                        onCheckedChange={(checked) =>
                          toggleEvent(event, checked === true)
                        }
                        className="mt-0.5"
                      />
                      <span className="min-w-0 text-sm">
                        <code className="font-mono text-[13px] text-ink">
                          {event}
                        </code>
                        <span className="block text-xs text-ink-3">
                          {t.webhooks.events[event]}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
                {formError.events && (
                  <p className="text-xs text-danger" role="alert">
                    {formError.events}
                  </p>
                )}
              </fieldset>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeEditor}
                  disabled={isSaving}
                >
                  {t.common.cancel}
                </Button>
                <Button type="submit" disabled={isSaving}>
                  {isSaving && <Loader2 className="animate-spin" aria-hidden />}
                  {editor?.mode === "edit" ? t.common.save : t.common.create}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <DeleteConfirmationModal
        isOpen={!!webhookToDelete}
        onClose={() => setWebhookToDelete(null)}
        onConfirm={handleDelete}
        title={t.webhooks.deleteTitle}
        description={t.webhooks.deleteDescription}
        itemName={webhookToDelete?.url ?? ""}
      />
    </>
  );
}
