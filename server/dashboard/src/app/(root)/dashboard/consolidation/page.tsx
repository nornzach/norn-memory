"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, Merge, Trash2, X } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DataTable } from "@/components/shared/data-table";
import { TableSkeleton } from "@/components/shared/table-skeleton";
import { EmptyState } from "@/components/self-hosted/empty-state";
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

const GOOD =
  "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-300";
const WARN =
  "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-300";
const BAD =
  "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-300";
const INFO =
  "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/40 dark:bg-sky-950/40 dark:text-sky-300";
const NEUTRAL =
  "border-memBorder-primary bg-surface-default-secondary text-onSurface-default-secondary";

const RUN_STATUS: Record<ConsolidationRunStatus, string> = {
  running: INFO,
  completed: GOOD,
  failed: BAD,
};

const PROPOSAL_STATUS: Record<ConsolidationProposalStatus, string> = {
  proposed: INFO,
  applied: GOOD,
  dismissed: NEUTRAL,
  stale: WARN,
  failed: BAD,
};

type Confirm =
  | { type: "apply-all"; run: ConsolidationRun }
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

function StatusBadge({
  label,
  className,
}: {
  label: string;
  className: string;
}) {
  return (
    <Badge variant="outline" className={className}>
      {label}
    </Badge>
  );
}

function ProposalCard({
  proposal,
  busy,
  onApply,
  onDismiss,
}: {
  proposal: ConsolidationProposal;
  busy: boolean;
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
  return (
    <Card className="border-memBorder-primary">
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={NEUTRAL}>
            {t.consolidation.kinds[proposal.kind]}
          </Badge>
          <StatusBadge
            label={t.consolidation.proposalStatus[proposal.status]}
            className={PROPOSAL_STATUS[proposal.status]}
          />
          {proposal.reason && (
            <span className="min-w-0 flex-1 basis-48 text-sm text-onSurface-default-secondary">
              {proposal.reason}
            </span>
          )}
        </div>

        <ul className="space-y-1.5">
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
              <li key={source.id} className="flex items-start gap-2 text-sm">
                <span
                  className={cn(
                    "w-14 shrink-0 pt-0.5 text-xs font-medium",
                    removed
                      ? "text-onSurface-danger-primary"
                      : "text-onSurface-default-tertiary",
                  )}
                >
                  {role}
                </span>
                <span className="min-w-0 break-words">
                  <span
                    className={cn(
                      removed && "line-through text-onSurface-default-tertiary",
                    )}
                  >
                    {source.memory}
                  </span>
                  {date && (
                    <span className="ml-1.5 whitespace-nowrap text-xs text-onSurface-default-tertiary">
                      {date}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>

        {isMerge && proposal.new_text && (
          <div className="rounded-md bg-surface-default-secondary p-3 text-sm">
            <span className="mb-1 block text-xs text-onSurface-default-tertiary">
              {t.consolidation.becomes}
            </span>
            {proposal.new_text}
          </div>
        )}

        {proposal.error && (
          <p className="text-xs text-onSurface-danger-primary">
            {proposal.error}
          </p>
        )}

        {proposal.status === "proposed" && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={onApply} disabled={busy}>
              <Check className="size-4 mr-1" /> {t.common.apply}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onDismiss}
              disabled={busy}
            >
              <X className="size-4 mr-1" /> {t.common.dismiss}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
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
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const selectedRef = useRef<string | null>(null);
  const { t, dateLocale } = useI18n();
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

  const handleStart = async () => {
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
    setBusyId(proposal.id);
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
      setBusyId(null);
    }
  };

  const handleConfirm = async () => {
    if (!confirm) return;
    const { type, run } = confirm;
    setConfirm(null);
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

  const columns = [
    {
      key: "created_at" as keyof ConsolidationRun,
      label: t.consolidation.columns.started,
      width: 120,
      render: (value: string) =>
        formatDistanceToNow(new Date(value), {
          addSuffix: true,
          locale: dateLocale,
        }),
    },
    {
      key: "scope" as keyof ConsolidationRun,
      label: t.consolidation.columns.scope,
      width: 160,
      render: (value: ConsolidationRun["scope"]) => (
        <span className="break-all">{scopeLabel(value, t.consolidation)}</span>
      ),
    },
    {
      key: "status" as keyof ConsolidationRun,
      label: t.consolidation.columns.status,
      width: 100,
      render: (value: ConsolidationRunStatus) => (
        <StatusBadge
          label={t.consolidation.runStatus[value]}
          className={RUN_STATUS[value]}
        />
      ),
    },
    {
      key: "actions" as keyof ConsolidationRun,
      label: t.consolidation.columns.pending,
      width: 90,
      render: (_: unknown, row: ConsolidationRun) =>
        row.status === "completed"
          ? t.consolidation.pendingOf(pendingCount(row), totalCount(row))
          : "--",
    },
    {
      key: "id" as keyof ConsolidationRun,
      label: "",
      width: 40,
      render: (_: string, row: ConsolidationRun) => (
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={t.consolidation.deleteRun}
          disabled={row.status === "running"}
          onClick={(e) => {
            e.stopPropagation();
            setConfirm({ type: "delete", run: row });
          }}
        >
          <Trash2 className="size-3.5 text-onSurface-danger-primary" />
        </Button>
      ),
    },
  ];

  const selectedRun = runs.find((r) => r.id === selectedId) ?? null;
  const shownDetail = detail && detail.id === selectedId ? detail : null;
  const pending =
    shownDetail?.proposals.filter((p) => p.status === "proposed").length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-72">
          <h1 className="text-xl font-semibold font-fustat">
            {t.consolidation.title}
          </h1>
          <p className="text-sm text-onSurface-default-secondary mt-1">
            {t.consolidation.subtitle}
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setDialogOpen(true)}
          disabled={anyRunning}
        >
          <Merge className="size-4 mr-1" /> {t.consolidation.run}
        </Button>
      </div>

      {isLoading && runs.length === 0 ? (
        <TableSkeleton rows={3} columns={4} />
      ) : runs.length === 0 ? (
        <EmptyState
          title={t.consolidation.emptyTitle}
          description={t.consolidation.emptyDescription}
        />
      ) : (
        <>
          <Card className="border-memBorder-primary overflow-hidden">
            <DataTable
              data={runs}
              columns={columns}
              getRowKey={(row) => row.id}
              onRowClick={(row) => setSelectedId(row.id)}
              getRowClassName={(row) =>
                cn(
                  "cursor-pointer",
                  row.id === selectedId && "bg-surface-default-secondary",
                )
              }
            />
          </Card>

          {selectedRun && (
            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold">
                    {scopeLabel(selectedRun.scope, t.consolidation)}
                  </h2>
                  <p className="text-xs text-onSurface-default-tertiary">
                    {selectedRun.status === "completed"
                      ? t.consolidation.summary(
                          selectedRun.memories_scanned,
                          selectedRun.clusters_found,
                          selectedRun.threshold.toFixed(2),
                        )
                      : t.consolidation.thresholdOnly(
                          selectedRun.threshold.toFixed(2),
                        )}
                  </p>
                </div>
                {pending > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setConfirm({ type: "apply-all", run: selectedRun })
                    }
                  >
                    <Check className="size-4 mr-1" />{" "}
                    {t.consolidation.applyAllPending(pending)}
                  </Button>
                )}
              </div>

              {selectedRun.status === "running" ? (
                <div className="flex items-center gap-2 py-8 text-sm text-onSurface-default-secondary">
                  <Loader2 className="size-4 animate-spin" />
                  {t.consolidation.scanning}
                </div>
              ) : selectedRun.status === "failed" ? (
                <p className="text-sm text-onSurface-danger-primary">
                  {selectedRun.error ?? t.consolidation.runFailed}
                </p>
              ) : !shownDetail ? (
                <TableSkeleton rows={2} columns={2} />
              ) : shownDetail.proposals.length === 0 ? (
                <p className="py-8 text-center text-sm text-onSurface-default-secondary">
                  {t.consolidation.nothingFound}
                </p>
              ) : (
                <div className="space-y-3">
                  {shownDetail.proposals.map((proposal) => (
                    <ProposalCard
                      key={proposal.id}
                      proposal={proposal}
                      busy={busyId === proposal.id}
                      onApply={() => resolveProposal(proposal, "apply")}
                      onDismiss={() => resolveProposal(proposal, "dismiss")}
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.consolidation.run}</DialogTitle>
            <DialogDescription>
              {t.consolidation.dialogDescription}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="consolidation-user">{t.common.userId}</Label>
                <Input
                  id="consolidation-user"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  placeholder={t.common.allUsers}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="consolidation-agent">{t.common.agentId}</Label>
                <Input
                  id="consolidation-agent"
                  value={agentId}
                  onChange={(e) => setAgentId(e.target.value)}
                  placeholder={t.common.allAgents}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="consolidation-threshold">
                {t.consolidation.similarity}
              </Label>
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
              <p className="text-xs text-onSurface-default-tertiary">
                {t.consolidation.similarityHint}
              </p>
            </div>
            <Button
              onClick={handleStart}
              disabled={isStarting}
              className="w-full"
            >
              {t.consolidation.start}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!confirm}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.type === "apply-all"
                ? t.consolidation.confirmApplyTitle(pending)
                : t.consolidation.confirmDeleteTitle}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.type === "apply-all"
                ? t.consolidation.confirmApplyDescription
                : t.consolidation.confirmDeleteDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm}>
              {confirm?.type === "apply-all" ? t.common.apply : t.common.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
