"use client";

import { FormEvent, useEffect, useId, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/shared/field";
import { toast } from "@/components/ui/use-toast";
import { getErrorMessage } from "@/lib/error-message";
import { api } from "@/utils/api";
import { MEMORY_ENDPOINTS } from "@/utils/api-endpoints";
import { todayUtc } from "@/lib/memory-expiry";
import { useI18n } from "@/i18n/provider";

interface AddMemoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Prefill the owner, e.g. the user the page is filtered to. */
  defaultUserId?: string;
  defaultAgentId?: string;
  /** Known user ids, offered as suggestions. */
  knownUsers?: string[];
  onAdded: () => void;
}

export function AddMemoryDialog({
  open,
  onOpenChange,
  defaultUserId = "",
  defaultAgentId = "",
  knownUsers = [],
  onAdded,
}: AddMemoryDialogProps) {
  const { t } = useI18n();
  const ids = useId();
  const [content, setContent] = useState("");
  const [userId, setUserId] = useState(defaultUserId);
  const [agentId, setAgentId] = useState(defaultAgentId);
  const [project, setProject] = useState("");
  const [expiry, setExpiry] = useState("");
  const [infer, setInfer] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ content?: string; id?: string }>({});

  useEffect(() => {
    if (open) {
      setUserId(defaultUserId);
      setAgentId(defaultAgentId);
      setError({});
    }
  }, [open, defaultUserId, defaultAgentId]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next: typeof error = {};
    if (!content.trim()) next.content = t.memories.needContent;
    if (!userId.trim() && !agentId.trim()) next.id = t.memories.needId;
    setError(next);
    if (next.content || next.id) return;

    setBusy(true);
    try {
      const res = await api.post(MEMORY_ENDPOINTS.BASE, {
        messages: [{ role: "user", content: content.trim() }],
        ...(userId.trim() && { user_id: userId.trim() }),
        ...(agentId.trim() && { agent_id: agentId.trim() }),
        ...(project.trim() && { project: project.trim() }),
        ...(expiry && { expiration_date: expiry }),
        infer,
        agent: "dashboard",
      });
      const results: { event?: string }[] = res.data?.results ?? [];
      const saved = results.filter(
        (r) => r.event === "ADD" || r.event === "UPDATE",
      ).length;
      if (saved > 0) {
        toast({ title: t.memories.added(saved), variant: "success" });
      } else {
        toast({
          title: t.memories.addedNone,
          description: t.memories.addedNoneHint,
        });
      }
      setContent("");
      setProject("");
      setExpiry("");
      onOpenChange(false);
      onAdded();
    } catch (err) {
      toast({
        title: t.memories.addFailed,
        description: getErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-lg">
        <form onSubmit={submit} className="grid gap-5" noValidate>
          <DialogHeader>
            <DialogTitle>{t.memories.addTitle}</DialogTitle>
            <DialogDescription>{t.memories.addDescription}</DialogDescription>
          </DialogHeader>

          <Field
            id={`${ids}-content`}
            label={t.memories.contentLabel}
            error={error.content}
          >
            <Textarea
              id={`${ids}-content`}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={t.memories.contentPlaceholder}
              rows={4}
              autoFocus
              aria-invalid={Boolean(error.content)}
            />
          </Field>

          <div className="grid gap-4 xs:grid-cols-2">
            <Field
              id={`${ids}-user`}
              label={t.memories.userIdLabel}
              hint={error.id ? undefined : t.memories.userIdHint}
              error={error.id}
            >
              <Input
                id={`${ids}-user`}
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                list={`${ids}-users`}
                autoComplete="off"
                aria-invalid={Boolean(error.id)}
              />
              <datalist id={`${ids}-users`}>
                {knownUsers.map((user) => (
                  <option key={user} value={user} />
                ))}
              </datalist>
            </Field>
            <Field
              id={`${ids}-agent`}
              label={t.memories.agentIdLabel}
              optional={t.memories.optional}
            >
              <Input
                id={`${ids}-agent`}
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                autoComplete="off"
              />
            </Field>
          </div>

          <div className="grid gap-4 xs:grid-cols-2">
            <Field
              id={`${ids}-project`}
              label={t.memories.projectLabel}
              optional={t.memories.optional}
            >
              <Input
                id={`${ids}-project`}
                value={project}
                onChange={(e) => setProject(e.target.value)}
                autoComplete="off"
              />
            </Field>
            <Field
              id={`${ids}-expiry`}
              label={t.memories.expiryLabel}
              optional={t.memories.optional}
            >
              <Input
                id={`${ids}-expiry`}
                type="date"
                value={expiry}
                min={todayUtc()}
                onChange={(e) => setExpiry(e.target.value)}
              />
            </Field>
          </div>

          <label
            htmlFor={`${ids}-infer`}
            className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-line bg-subtle/50 p-3"
          >
            <span className="min-w-0">
              <span className="block text-sm font-medium text-ink">
                {t.memories.inferLabel}
              </span>
              <span className="mt-0.5 block text-xs text-ink-3">
                {t.memories.inferHint}
              </span>
            </span>
            <Switch
              id={`${ids}-infer`}
              checked={infer}
              onCheckedChange={setInfer}
              className="mt-0.5"
            />
          </label>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              {t.common.cancel}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="animate-spin" aria-hidden />}
              {t.memories.add}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
