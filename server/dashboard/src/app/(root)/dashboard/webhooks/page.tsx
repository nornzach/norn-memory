"use client";

import { useState } from "react";
import { Check, Copy, Plus, Send, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { CopyToClipboard } from "react-copy-to-clipboard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DataTable } from "@/components/shared/data-table";
import { TableSkeleton } from "@/components/shared/table-skeleton";
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

export default function WebhooksPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<WebhookEvent[]>([
    "memory.created",
    "memory.updated",
    "memory.deleted",
  ]);
  const [newSecret, setNewSecret] = useState("");
  const [copied, setCopied] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [webhookToDelete, setWebhookToDelete] = useState<Webhook | null>(null);
  const { t, dateLocale } = useI18n();

  const {
    data: webhooks = [],
    isLoading,
    refetch,
  } = useApiQuery<Webhook[]>(
    async () => {
      const res = await api.get<Webhook[]>(WEBHOOK_ENDPOINTS.BASE);
      return res.data ?? [];
    },
    { errorToast: t.webhooks.loadFailed, initialData: [] },
  );

  const handleDialogChange = (open: boolean) => {
    if (!open) {
      setUrl("");
      setEvents(["memory.created", "memory.updated", "memory.deleted"]);
      setNewSecret("");
      setCopied(false);
    }
    setCreateOpen(open);
  };

  const toggleEvent = (event: WebhookEvent, checked: boolean) => {
    setEvents((current) =>
      checked ? [...current, event] : current.filter((e) => e !== event),
    );
  };

  const handleCreate = async () => {
    setIsSaving(true);
    try {
      const res = await api.post<WebhookCreateResponse>(
        WEBHOOK_ENDPOINTS.BASE,
        { url: url.trim(), events },
      );
      setNewSecret(res.data.secret);
      void refetch();
    } catch (error) {
      toast({
        title: t.webhooks.createFailed,
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleActive = async (webhook: Webhook, isActive: boolean) => {
    try {
      await api.patch(WEBHOOK_ENDPOINTS.BY_ID(webhook.id), {
        is_active: isActive,
      });
      void refetch();
    } catch (error) {
      toast({
        title: t.webhooks.updateFailed,
        description: getErrorMessage(error),
        variant: "destructive",
      });
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
    } catch (error) {
      toast({
        title: t.webhooks.sendTestFailed,
        description: getErrorMessage(error),
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
    } catch (error) {
      toast({
        title: t.webhooks.deleteFailed,
        description: getErrorMessage(error),
        variant: "destructive",
      });
    }
  };

  const columns = [
    {
      key: "url" as keyof Webhook,
      label: t.webhooks.columns.endpoint,
      width: 240,
      render: (value: string) => (
        <code className="text-xs font-mono break-all">{value}</code>
      ),
    },
    {
      key: "events" as keyof Webhook,
      label: t.webhooks.columns.events,
      width: 200,
      render: (value: WebhookEvent[]) => (
        <div className="flex flex-wrap gap-1">
          {value.map((event) => (
            <Badge key={event} variant="outline" className="font-mono text-xs">
              {event}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      key: "last_status_code" as keyof Webhook,
      label: t.webhooks.columns.lastDelivery,
      width: 140,
      render: (_: number | null, row: Webhook) => {
        if (!row.last_delivery_at) {
          return (
            <span className="text-xs text-onSurface-default-tertiary">
              {t.common.never}
            </span>
          );
        }
        return (
          <div className="flex items-center gap-2" title={row.last_error ?? ""}>
            <Badge
              variant="outline"
              className={getStatusClassName(row.last_status_code ?? 500)}
            >
              {row.last_status_code ?? t.webhooks.error}
            </Badge>
            <span className="text-xs text-onSurface-default-tertiary">
              {formatDistanceToNow(new Date(row.last_delivery_at), {
                addSuffix: true,
                locale: dateLocale,
              })}
            </span>
          </div>
        );
      },
    },
    {
      key: "is_active" as keyof Webhook,
      label: t.webhooks.columns.active,
      width: 60,
      render: (value: boolean, row: Webhook) => (
        <Switch
          checked={value}
          aria-label={t.webhooks.toggleLabel(row.url)}
          onCheckedChange={(checked) => handleToggleActive(row, checked)}
        />
      ),
    },
    {
      key: "id" as keyof Webhook,
      label: "",
      width: 70,
      render: (_: string, row: Webhook) => (
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={t.webhooks.testLabel(row.url)}
            disabled={testingId === row.id}
            onClick={() => handleTest(row)}
          >
            <Send className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={t.webhooks.deleteLabel(row.url)}
            onClick={() => setWebhookToDelete(row)}
          >
            <Trash2 className="size-3.5 text-onSurface-danger-primary" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-72">
          <h1 className="text-xl font-semibold font-fustat">
            {t.webhooks.title}
          </h1>
          <p className="text-sm text-onSurface-default-secondary mt-1">
            {t.webhooks.subtitle}
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="size-4 mr-1" /> {t.webhooks.add}
        </Button>
      </div>

      {isLoading ? (
        <TableSkeleton rows={3} columns={5} />
      ) : webhooks.length === 0 ? (
        <EmptyState
          title={t.webhooks.emptyTitle}
          description={t.webhooks.emptyDescription}
        />
      ) : (
        <Card className="border-memBorder-primary overflow-hidden">
          <DataTable
            data={webhooks}
            columns={columns}
            getRowKey={(row) => row.id}
          />
        </Card>
      )}

      <Dialog open={createOpen} onOpenChange={handleDialogChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.webhooks.addTitle}</DialogTitle>
            <DialogDescription>{t.webhooks.addDescription}</DialogDescription>
          </DialogHeader>
          {!newSecret ? (
            <div className="space-y-4 mt-2">
              <div className="space-y-2">
                <Label htmlFor="webhook-url">{t.webhooks.endpointUrl}</Label>
                <Input
                  id="webhook-url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://your-app.com/webhooks/mem0"
                />
              </div>
              <div className="space-y-2">
                <Label>{t.webhooks.eventsLabel}</Label>
                <div className="flex flex-col gap-2">
                  {WEBHOOK_EVENTS.map((event) => (
                    <label
                      key={event}
                      className="flex items-start gap-2 cursor-pointer"
                    >
                      <Checkbox
                        checked={events.includes(event)}
                        onCheckedChange={(checked) =>
                          toggleEvent(event, checked === true)
                        }
                        className="mt-0.5"
                      />
                      <span className="text-sm">
                        <code className="font-mono">{event}</code>
                        <span className="block text-xs text-onSurface-default-tertiary">
                          {t.webhooks.events[event]}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              <Button
                onClick={handleCreate}
                disabled={!url.trim() || events.length === 0 || isSaving}
                className="w-full"
              >
                {t.common.create}
              </Button>
            </div>
          ) : (
            <div className="space-y-4 mt-2">
              <div className="space-y-2">
                <Label htmlFor="webhook-secret">
                  {t.webhooks.signingSecret}
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="webhook-secret"
                    value={newSecret}
                    readOnly
                    className="font-mono text-sm"
                  />
                  <CopyToClipboard
                    text={newSecret}
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
                <p className="text-xs text-onSurface-default-secondary">
                  {t.webhooks.verifyHint}
                </p>
                <p className="text-xs text-onSurface-danger-primary">
                  {t.common.saveSecretWarning}
                </p>
              </div>
              <Button
                onClick={() => handleDialogChange(false)}
                className="w-full"
              >
                {t.common.done}
              </Button>
            </div>
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
    </div>
  );
}
