"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  GitMerge,
  Loader2,
  Merge,
  Trash2,
  X,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import DeleteConfirmationModal from "@/components/ui/delete-confirmation-modal";
import { Field } from "@/components/shared/field";
import { PageHeader, Panel, PanelHeader } from "@/components/shared/page";
import { EmptyState } from "@/components/self-hosted/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/use-toast";
import { getErrorMessage } from "@/lib/error-message";
import { cn } from "@/lib/utils";
import { api } from "@/utils/api";
import { CONSOLIDATION_ENDPOINTS } from "@/utils/api-endpoints";
import { useApiQuery } from "@/hooks/use-api-query";
import {
  ConsolidationApplyAllResponse,
  ConsolidationProposal,
  ConsolidationProposalStatus,
  ConsolidationRun,
  ConsolidationRunDetail,
  ConsolidationRunStatus,
} from "@/types/api";
import { useI18n } from "@/i18n/provider";
import type { Messages } from "@/i18n/messages";

const POLL_INTERVAL_MS = 2500;

const THRESHOLDS = [
  { value: "0.7", key: "broad" },
  { value: "0.75", key: "loose" },
  { value: "0.8", key: "balanced" },
  { value: "0.9", key: "strict" },
] as const;

type Tone = NonNullable<BadgeProps["variant"]>;

const RUN_STATUS: Record<ConsolidationRunStatus, Tone> = {
  running: "info",
  completed: "success",
  failed: "destructive",
};

const PROPOSAL_STATUS: Record<ConsolidationProposalStatus, Tone> = {
  proposed: "info",
  applied: "success",
  dismissed: "secondary",
  stale: "warning",
  failed: "destructive",
};

type Confirm =
  | { type: "apply-all"; run: ConsolidationRun; count: number }
  | { type: "delete"; run: ConsolidationRun };

const scopeLabel = (
  scope: ConsolidationRun["scope"],
  labels: Messages["consolidation"],
) => {
  const parts = Object.entries(scope).map(
    ([key, value]) =>
      `${labels.scopeKeys[key as keyof typeof labels.scopeKeys] ?? key}: ${value}`,
  );
  return parts.length ? parts.join(", ") : labels.allMemories;
};

const pendingCount = (run: ConsolidationRun) => run.actions.proposed ?? 0;

const totalCount = (run: ConsolidationRun) =>
  Object.values(run.actions).reduce((sum, n) => sum + (n ?? 0), 0);

function ProposalCard({
  proposal,
  busy,
  onApply,
  onDismiss,
}: {
  proposal: ConsolidationProposal;
  busy: "apply" | "dismiss" | null;
  onApply: () => void;
  onDismiss: () => void;
}) {
  const { t, dateLocale } = useI18n();
  const isMerge = proposal.kind === "merge";
  const shortDate = (value: string | null) => {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime())
      ? format(date, t.common.dateFormat, { locale: dateLocale })
      : null;
  };
  // Only pending and applied proposals delete anything; otherwise the roles are shown muted.
  const live = proposal.status === "proposed" || proposal.status === "applied";
  const pending = proposal.status === "proposed";

  return (
    <article
      className={cn(
        "rounded-xl border bg-panel shadow-elev-1",
        pending ? "border-line" : "border-line opacity-80",
      )}
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <Badge variant="outline">
          {isMerge ? <GitMerge aria-hidden /> : <ArrowRight aria-hidden />}
          {t.consolidation.kinds[proposal.kind]}
        </Badge>
        <Badge variant={PROPOSAL_STATUS[proposal.status]}>
          {t.consolidation.proposalStatus[proposal.status]}
        </Badge>
        {proposal.reason && (
          <p className="w-full text-sm leading-5 text-ink-2 sm:w-auto sm:min-w-0 sm:flex-1">
            {proposal.reason}
          </p>
        )}
      </header>

      <div className="space-y-3 px-4 py-3">
        <ul className="space-y-2">
          {proposal.sources.map((source) => {
            const marked = proposal.remove_ids.includes(source.id);
            const removed = live && marked;
            const role = marked
              ? t.consolidation.roles.delete
              : isMerge
                ? t.consolidation.roles.rewrite
                : t.consolidation.roles.keep;
            const date = shortDate(source.created_at);
            return (
              <li
                key={source.id}
                className="flex flex-col gap-1 text-sm xs:flex-row xs:items-start xs:gap-3"
              >
                <span
                  className={cn(
                    "w-16 shrink-0 text-xs font-medium leading-5",
                    removed ? "text-danger" : "text-ink-3",
                  )}
                >
                  {role}
                </span>
                <span className="min-w-0 break-words leading-5">
                  <span className={cn(removed && "text-ink-3 line-through")}>
                    {source.memory}
                  </span>
                  {date && (
                    <span className="ml-2 whitespace-nowrap text-xs text-ink-3">
                      {date}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>

        {isMerge && proposal.new_text && (
          <div className="rounded-lg border border-brand/30 bg-brand-soft px-3 py-2.5 text-sm leading-5 text-ink">
            <span className="mb-1 block text-xs font-medium text-brand-text">
              {t.consolidation.becomes}
            </span>
            {proposal.new_text}
          </div>
        )}

        {proposal.error && (
          <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
            {proposal.error}
          </p>
        )}
      </div>

      {pending && (
        <footer className="flex flex-col-reverse gap-2 border-t border-line px-4 py-3 xs:flex-row xs:justify-end">
          <Button
            size="sm"
            variant="outline"
            onClick={onDismiss}
            disabled={busy !== null}
          >
            {busy === "dismiss" ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <X aria-hidden />
            )}
            {t.common.dismiss}
          </Button>
          <Button size="sm" onClick={onApply} disabled={busy !== null}>
            {busy === "apply" ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Check aria-hidden />
            )}
            {t.common.apply}
          </Button>
        </footer>
      )}
    </article>
  );
}

function RunList({
  runs,
  selectedId,
  onSelect,
  onDelete,
}: {
  runs: ConsolidationRun[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (run: ConsolidationRun) => void;
}) {
  const { t, dateLocale } = useI18n();
  return (
    <ul className="divide-y divide-line">
      {runs.map((run) => {
        const active = run.id === selectedId;
        return (
          <li key={run.id} className="relative">
            <button
              type="button"
              onClick={() => onSelect(run.id)}
              aria-current={active ? "true" : undefined}
              className={cn(
                "flex w-full flex-col gap-1.5 py-3 pl-4 pr-12 text-left transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-[var(--focus)] sm:pl-5",
                active ? "bg-brand-soft" : "hover:bg-subtle",
              )}
            >
              {active && (
                <span
                  className="absolute inset-y-0 left-0 w-0.5 bg-brand"
                  aria-hidden
                />
              )}
              <span className="flex items-center gap-2">
                <span className="min-w-0 truncate text-sm font-medium text-ink">
                  {scopeLabel(run.scope, t.consolidation)}
                </span>
                <Badge variant={RUN_STATUS[run.status]} className="shrink-0">
                  {run.status === "running" && (
                    <Loader2 className="animate-spin" aria-hidden />
                  )}
                  {t.consolidation.runStatus[run.status]}
                </Badge>
              </span>
              <span className="flex flex-wrap items-center gap-x-3 text-xs text-ink-3">
                <span>
                  {formatDistanceToNow(new Date(run.created_at), {
                    addSuffix: true,
                    locale: dateLocale,
                  })}
                </span>
                {run.status === "completed" && (
                  <span className="tabular">
                    {t.consolidation.columns.pending}{" "}
                    {t.consolidation.pendingOf(
                      pendingCount(run),
                      totalCount(run),
                    )}
                  </span>
                )}
              </span>
            </button>
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-2.5 size-8 text-ink-3 hover:bg-danger-soft hover:text-danger"
              aria-label={t.consolidation.deleteRun}
              disabled={run.status === "running"}
              onClick={() => onDelete(run)}
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

export default function ConsolidationPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [userId, setUserId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [threshold, setThreshold] = useState("0.8");
  const [isStarting, setIsStarting] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConsolidationRunDetail | null>(null);
  const [busy, setBusy] = useState<{
    id: string;
    action: "apply" | "dismiss";
  } | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const selectedRef = useRef<string | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  // Read through a ref so loadDetail stays stable across language switches.
  const tRef = useRef(t);
  tRef.current = t;
  selectedRef.current = selectedId;

  const {
    data: runs = [],
    isLoading,
    refetch: refetchRuns,
  } = useApiQuery<ConsolidationRun[]>(
    async () => {
      const res = await api.get<ConsolidationRun[]>(
        CONSOLIDATION_ENDPOINTS.RUNS,
      );
      return res.data ?? [];
    },
    { errorToast: t.consolidation.loadFailed, initialData: [] },
  );

  const loadDetail = useCallback(async (runId: string) => {
    try {
      const res = await api.get<ConsolidationRunDetail>(
        CONSOLIDATION_ENDPOINTS.RUN(runId),
      );
      // Ignore a slow response for a run that is no longer selected.
      if (selectedRef.current === runId) setDetail(res.data);
    } catch (error) {
      toast({
        title: tRef.current.consolidation.runLoadFailed,
        description: getErrorMessage(error),
        variant: "destructive",
      });
    }
  }, []);

  // Keep a valid run selected: the newest one by default, or after the selected one is deleted.
  useEffect(() => {
    if (!runs.length) {
      setSelectedId(null);
    } else if (!selectedId || !runs.some((r) => r.id === selectedId)) {
      setSelectedId(runs[0].id);
    }
  }, [runs, selectedId]);

  useEffect(() => {
    if (selectedId) {
      void loadDetail(selectedId);
    } else {
      setDetail(null);
    }
  }, [selectedId, loadDetail]);

  const anyRunning = runs.some((r) => r.status === "running");
  useEffect(() => {
    if (!anyRunning) return;
    const timer = setInterval(() => {
      void refetchRuns();
      if (selectedRef.current) void loadDetail(selectedRef.current);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [anyRunning, refetchRuns, loadDetail]);

  const selectRun = (id: string) => {
    setSelectedId(id);
    // On one-column layouts the proposals sit below the list; bring them into view.
    if (window.matchMedia("(max-width: 1023px)").matches) {
      requestAnimationFrame(() =>
        detailRef.current?.scrollIntoView({ behavior: "smooth" }),
      );
    }
  };

  const handleStart = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isStarting) return;
    setIsStarting(true);
    try {
      const body: Record<string, string | number> = {
        threshold: Number(threshold),
      };
      if (userId.trim()) body.user_id = userId.trim();
      if (agentId.trim()) body.agent_id = agentId.trim();
      const res = await api.post<ConsolidationRun>(
        CONSOLIDATION_ENDPOINTS.RUNS,
        body,
      );
      setDialogOpen(false);
      toast({
        title: t.consolidation.started,
        description: t.consolidation.startedDescription,
        variant: "success",
      });
      // Select only once the list has the new run, or the selection effect falls back to the old newest one.
      await refetchRuns();
      setSelectedId(res.data.id);
    } catch (error) {
      toast({
        title: t.consolidation.startFailed,
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setIsStarting(false);
    }
  };

  const resolveProposal = async (
    proposal: ConsolidationProposal,
    action: "apply" | "dismiss",
  ) => {
    setBusy({ id: proposal.id, action });
    try {
      const url =
        action === "apply"
          ? CONSOLIDATION_ENDPOINTS.APPLY(proposal.id)
          : CONSOLIDATION_ENDPOINTS.DISMISS(proposal.id);
      const res = await api.post<ConsolidationProposal>(url);
      const updated = res.data;
      setDetail((current) =>
        current
          ? {
              ...current,
              proposals: current.proposals.map((p) =>
                p.id === updated.id ? updated : p,
              ),
            }
          : current,
      );
      if (updated.status === "stale" || updated.status === "failed") {
        toast({
          title:
            updated.status === "stale"
              ? t.consolidation.proposalStale
              : t.consolidation.proposalFailed,
          description: updated.error ?? undefined,
          variant: "destructive",
        });
      }
      void refetchRuns();
    } catch (error) {
      toast({
        title: t.consolidation.resolveFailed(action),
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const handleConfirm = async () => {
    if (!confirm) return;
    const { type, run } = confirm;
    try {
      if (type === "apply-all") {
        const res = await api.post<ConsolidationApplyAllResponse>(
          CONSOLIDATION_ENDPOINTS.APPLY_RUN(run.id),
        );
        const { applied, stale, failed } = res.data;
        const skipped = stale + failed;
        toast({
          title: t.consolidation.appliedCount(applied),
          description: skipped
            ? t.consolidation.skippedCount(skipped)
            : undefined,
          variant: skipped ? "destructive" : "success",
        });
        void loadDetail(run.id);
      } else {
        await api.delete(CONSOLIDATION_ENDPOINTS.RUN(run.id));
        toast({ title: t.consolidation.runDeleted, variant: "success" });
      }
      setConfirm(null);
      void refetchRuns();
    } catch (error) {
      toast({
        title:
          type === "apply-all"
            ? t.consolidation.applyFailed
            : t.consolidation.deleteFailed,
        description: getErrorMessage(error),
        variant: "destructive",
      });
    }
  };

  const [applyingAll, setApplyingAll] = useState(false);
  const runApplyAll = async () => {
    setApplyingAll(true);
    try {
      await handleConfirm();
    } finally {
      setApplyingAll(false);
    }
  };

  const selectedRun = runs.find((r) => r.id === selectedId) ?? null;
  const shownDetail = detail && detail.id === selectedId ? detail : null;
  const pending =
    shownDetail?.proposals.filter((p) => p.status === "proposed").length ?? 0;

  const runDetail = selectedRun && (
    <div ref={detailRef} className="min-w-0 scroll-mt-20 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="break-words text-base font-semibold text-ink">
            {scopeLabel(selectedRun.scope, t.consolidation)}
          </h2>
          <p className="mt-0.5 text-sm text-ink-3">
            {selectedRun.status === "completed"
              ? t.consolidation.summary(
                  selectedRun.memories_scanned,
                  selectedRun.clusters_found,
                  selectedRun.threshold.toFixed(2),
                )
              : t.consolidation.thresholdOnly(selectedRun.threshold.toFixed(2))}
          </p>
        </div>
        {pending > 0 && (
          <Button
            variant="outline"
            className="shrink-0"
            onClick={() =>
              setConfirm({
                type: "apply-all",
                run: selectedRun,
                count: pending,
              })
            }
          >
            <Check aria-hidden />
            {t.consolidation.applyAllPending(pending)}
          </Button>
        )}
      </div>

      {selectedRun.status === "running" ? (
        <Panel className="flex items-center gap-3 px-5 py-10 text-sm text-ink-2">
          <Loader2 className="size-4 animate-spin text-brand" aria-hidden />
          <span role="status">{t.consolidation.scanning}</span>
        </Panel>
      ) : selectedRun.status === "failed" ? (
        <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
          {selectedRun.error ?? t.consolidation.runFailed}
        </p>
      ) : !shownDetail ? (
        <div className="space-y-3">
          <Skeleton className="h-36 w-full rounded-xl" />
          <Skeleton className="h-36 w-full rounded-xl" />
        </div>
      ) : shownDetail.proposals.length === 0 ? (
        <Panel className="px-5 py-10 text-center text-sm text-ink-3">
          {t.consolidation.nothingFound}
        </Panel>
      ) : (
        <div className="space-y-3">
          {shownDetail.proposals.map((proposal) => (
            <ProposalCard
              key={proposal.id}
              proposal={proposal}
              busy={busy?.id === proposal.id ? busy.action : null}
              onApply={() => resolveProposal(proposal, "apply")}
              onDismiss={() => resolveProposal(proposal, "dismiss")}
            />
          ))}
        </div>
      )}
    </div>
  );

  return (
    <>
      <PageHeader
        title={t.consolidation.title}
        description={t.consolidation.subtitle}
        actions={
          <Button onClick={() => setDialogOpen(true)} disabled={anyRunning}>
            {anyRunning ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Merge aria-hidden />
            )}
            {t.consolidation.run}
          </Button>
        }
      />

      {isLoading && runs.length === 0 ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] lg:gap-6">
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      ) : runs.length === 0 ? (
        <Panel>
          <EmptyState
            title={t.consolidation.emptyTitle}
            description={t.consolidation.emptyDescription}
            icon={Merge}
          >
            <Button onClick={() => setDialogOpen(true)}>
              <Merge aria-hidden />
              {t.consolidation.run}
            </Button>
          </EmptyState>
        </Panel>
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] lg:gap-6">
          <Panel className="lg:sticky lg:top-6">
            <PanelHeader
              title={t.consolidation.runs}
              className="py-3 sm:py-3"
            />
            <div className="scrollbar-thin max-h-[360px] overflow-y-auto lg:max-h-[calc(100dvh-12rem)]">
              <RunList
                runs={runs}
                selectedId={selectedId}
                onSelect={selectRun}
                onDelete={(run) => setConfirm({ type: "delete", run })}
              />
            </div>
          </Panel>
          {runDetail}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <form onSubmit={handleStart} className="space-y-5">
            <DialogHeader>
              <DialogTitle>{t.consolidation.run}</DialogTitle>
              <DialogDescription>
                {t.consolidation.dialogDescription}
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                id="consolidation-user"
                label={t.common.userId}
                optional={t.memories.optional}
              >
                <Input
                  id="consolidation-user"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  placeholder={t.common.allUsers}
                  autoComplete="off"
                />
              </Field>
              <Field
                id="consolidation-agent"
                label={t.common.agentId}
                optional={t.memories.optional}
              >
                <Input
                  id="consolidation-agent"
                  value={agentId}
                  onChange={(e) => setAgentId(e.target.value)}
                  placeholder={t.common.allAgents}
                  autoComplete="off"
                />
              </Field>
            </div>
            <Field
              id="consolidation-threshold"
              label={t.consolidation.similarity}
              hint={t.consolidation.similarityHint}
            >
              <Select value={threshold} onValueChange={setThreshold}>
                <SelectTrigger id="consolidation-threshold">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {THRESHOLDS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {t.consolidation.thresholds[option.key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                {t.common.cancel}
              </Button>
              <Button type="submit" disabled={isStarting}>
                {isStarting && <Loader2 className="animate-spin" aria-hidden />}
                {t.consolidation.start}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirm?.type === "apply-all"}
        onOpenChange={(open) => !open && !applyingAll && setConfirm(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {confirm?.type === "apply-all" &&
                t.consolidation.confirmApplyTitle(confirm.count)}
            </DialogTitle>
            <DialogDescription>
              {t.consolidation.confirmApplyDescription}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirm(null)}
              disabled={applyingAll}
            >
              {t.common.cancel}
            </Button>
            <Button onClick={runApplyAll} disabled={applyingAll}>
              {applyingAll ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Check aria-hidden />
              )}
              {t.common.apply}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteConfirmationModal
        isOpen={confirm?.type === "delete"}
        onClose={() => setConfirm(null)}
        onConfirm={handleConfirm}
        title={t.consolidation.confirmDeleteTitle}
        description={t.consolidation.confirmDeleteDescription}
        itemName={
          confirm?.type === "delete"
            ? scopeLabel(confirm.run.scope, t.consolidation)
            : ""
        }
      />
    </>
  );
}
