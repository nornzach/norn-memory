"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/shared/page";
import { useI18n } from "@/i18n/provider";
import { getErrorMessage } from "@/lib/error-message";
import { api } from "@/utils/api";

type Proposal = {
  id: string;
  project: string;
  candidate: {
    action: string;
    type: string;
    key: string;
    title: string;
    summary: string;
    sources: { job_id?: string; role?: string; message?: number }[];
  };
};

type KnowledgeItem = {
  id: string;
  project: string;
  title: string;
  layer: "L0" | "L1" | "L2";
  revision: number;
  trigger: string;
  summary: string;
  verify_before_use?: string | null;
  needs_recheck?: string | null;
  procedure?: {
    prerequisites: string[];
    steps: { id: string; text: string }[];
    success_criteria: string[];
    failure_branches: { id: string; text: string }[];
  } | null;
  evidence: { source: string; observed_at: string; observation: string }[];
};

function PublishedItem({ item }: { item: KnowledgeItem }) {
  const { t } = useI18n();
  const labels = t.knowledge;
  const procedure = item.procedure;
  const sections = procedure
    ? ([
        [labels.prerequisites, procedure.prerequisites],
        [labels.steps, procedure.steps.map(({ text }) => text)],
        [
          labels.failureBranches,
          procedure.failure_branches.map(({ text }) => text),
        ],
        [labels.successCriteria, procedure.success_criteria],
      ] as const)
    : [];
  return (
    <details className="group rounded-lg border border-line bg-panel p-4">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 break-words">
          <span className="block font-medium">{item.title}</span>
          <span className="text-xs text-ink-3">
            {labels.layers[item.layer]} · {item.project || labels.noProject} ·{" "}
            {labels.revision} {item.revision}
          </span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className="mt-1 size-4 shrink-0 group-open:rotate-180"
        />
      </summary>
      <div className="mt-3 space-y-4 break-words text-sm">
        <p>{item.summary}</p>
        <p>
          <strong>{labels.trigger}:</strong> {item.trigger}
        </p>
        {item.verify_before_use && (
          <p>
            <strong>{labels.verify}:</strong> {item.verify_before_use}
          </p>
        )}
        {item.needs_recheck && (
          <p>
            <strong>{labels.recheck}:</strong> {item.needs_recheck}
          </p>
        )}
        {sections.map(
          ([title, entries]) =>
            entries.length > 0 && (
              <div key={title}>
                <h2 className="font-medium">{title}</h2>
                <ol className="ml-5 list-decimal space-y-1">
                  {entries.map((entry, index) => (
                    <li key={index}>{entry}</li>
                  ))}
                </ol>
              </div>
            ),
        )}
        {item.evidence.length > 0 && (
          <div className="space-y-2 border-t border-line pt-3">
            <h2 className="font-medium">{labels.evidence}</h2>
            {item.evidence.map((entry, index) => (
              <div key={index}>
                <p>{entry.observation}</p>
                <p className="text-xs text-ink-3">
                  <time dateTime={entry.observed_at}>
                    {new Date(entry.observed_at).toLocaleString()}
                  </time>
                  {" · "}
                  {/^https?:\/\//i.test(entry.source) ? (
                    <a
                      className="underline"
                      href={entry.source}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {entry.source}
                    </a>
                  ) : (
                    entry.source
                  )}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

function ProposalReview({
  proposal,
  done,
}: {
  proposal: Proposal;
  done: () => void;
}) {
  const { t } = useI18n();
  const labels = t.knowledge;
  const candidate = proposal.candidate;
  const [reason, setReason] = useState("");
  const [source, setSource] = useState("");
  const [observation, setObservation] = useState("");
  const [observedAt, setObservedAt] = useState("");
  const [status, setStatus] = useState(
    candidate.type === "constraint" ? "user_confirmed" : "verified",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [edit, setEdit] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [messages, setMessages] = useState<{ role: string; content: string }[]>(
    [],
  );
  const job = candidate.sources.find((entry) => entry.job_id)?.job_id;
  const needsEvidence = candidate.type !== "handoff";

  async function review(decision: "publish" | "recheck" | "dismiss") {
    setBusy(true);
    setError("");
    try {
      const revisedCandidate =
        edit && decision !== "dismiss" ? JSON.parse(edit) : undefined;
      const evidence =
        decision !== "dismiss" && needsEvidence
          ? [
              {
                source,
                observation,
                observed_at: new Date(observedAt).toISOString(),
              },
            ]
          : [];
      await api.post(`/knowledge/proposals/${proposal.id}/review`, {
        decision,
        reason,
        evidence_status: evidence.length ? status : null,
        evidence,
        revised_candidate: revisedCandidate,
      });
      done();
    } catch (failure) {
      setError(getErrorMessage(failure, labels.failed));
    } finally {
      setBusy(false);
    }
  }

  async function loadEvidence() {
    try {
      const { data } = await api.get(`/ingest/jobs/${job}`);
      setMessages(data.messages);
    } catch (failure) {
      setError(getErrorMessage(failure, labels.failed));
    }
  }

  async function loadCurrent() {
    try {
      const { data } = await api.get(
        `/knowledge/proposals/${proposal.id}/current`,
      );
      setCurrent(JSON.stringify(data, null, 2));
    } catch (failure) {
      setError(getErrorMessage(failure, labels.failed));
    }
  }

  const ready = !busy && Boolean(reason.trim());

  return (
    <details className="space-y-3 rounded-xl border border-line bg-panel p-4">
      <summary className="cursor-pointer font-medium">
        {candidate.title} · {proposal.project || labels.noProject} ·{" "}
        {candidate.action}
      </summary>
      <p>{candidate.summary}</p>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded border border-line p-3 text-xs">
        {JSON.stringify(candidate, null, 2)}
      </pre>
      {edit === null && (
        <Button
          variant="outline"
          onClick={() => {
            const { sources, ...editable } = candidate;
            setEdit(
              JSON.stringify(
                {
                  ...editable,
                  action:
                    candidate.action === "draft" ? "create" : candidate.action,
                  evidence_refs: [sources[0]?.message || 1],
                },
                null,
                2,
              ),
            );
          }}
        >
          {labels.edit}
        </Button>
      )}
      {edit !== null && (
        <Textarea
          aria-label={labels.edit}
          className="min-h-56 font-mono"
          value={edit}
          onChange={(event) => setEdit(event.target.value)}
        />
      )}
      {(candidate.action === "patch" || candidate.action === "review") && (
        <Button variant="outline" onClick={loadCurrent}>
          {labels.current}
        </Button>
      )}
      {current && (
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">
          {current}
        </pre>
      )}
      {job && (
        <Button variant="outline" onClick={loadEvidence}>
          {labels.showExchange}
        </Button>
      )}
      {messages.map((entry, index) => (
        <p
          key={index}
          className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-sm"
        >
          <strong>{entry.role}:</strong> {entry.content}
        </p>
      ))}
      <div className="grid gap-3 md:grid-cols-2">
        <label>
          {labels.reason}
          <Input
            value={reason}
            maxLength={1200}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        {needsEvidence && (
          <>
            <label>
              {labels.source}
              <Input
                value={source}
                maxLength={1200}
                onChange={(event) => setSource(event.target.value)}
              />
            </label>
            <label>
              {labels.observation}
              <Textarea
                value={observation}
                maxLength={1200}
                onChange={(event) => setObservation(event.target.value)}
              />
            </label>
            <label>
              {labels.observedAt}
              <Input
                type="datetime-local"
                value={observedAt}
                onChange={(event) => setObservedAt(event.target.value)}
              />
            </label>
            <select
              aria-label={labels.review}
              className="rounded border border-line bg-panel p-2"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="verified">{labels.verified}</option>
              <option value="user_confirmed">{labels.confirmed}</option>
            </select>
          </>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={
            !ready ||
            (needsEvidence &&
              !(source.trim() && observation.trim() && observedAt))
          }
          onClick={() =>
            review(candidate.action === "review" ? "recheck" : "publish")
          }
        >
          {candidate.action === "review" ? labels.recheck : labels.publish}
        </Button>
        <Button
          variant="outline"
          disabled={!ready}
          onClick={() => review("dismiss")}
        >
          {labels.dismiss}
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}

const PAGE_SIZE = 30;

function KnowledgeList<T extends { id: string }>({
  path,
  empty,
  children,
}: {
  path: string;
  empty: string;
  children: (item: T, reload: () => void) => ReactNode;
}) {
  const { t } = useI18n();
  const labels = t.knowledge;
  const [page, setPage] = useState(0);
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState<{
    page: number;
    version: number;
    items?: T[];
    failed?: boolean;
  } | null>(null);
  const visible =
    result?.page === page && result.version === version ? result : null;
  const reload = () => setVersion((value) => value + 1);

  useEffect(() => {
    const request = new AbortController();
    api
      .get<T[]>(path, {
        params: { limit: PAGE_SIZE + 1, offset: page * PAGE_SIZE },
        signal: request.signal,
      })
      .then(({ data: items }) => {
        if (!request.signal.aborted) setResult({ page, version, items });
      })
      .catch(() => {
        if (!request.signal.aborted) setResult({ page, version, failed: true });
      });
    return () => request.abort();
  }, [path, page, version]);

  return (
    <div className="space-y-3" aria-busy={visible === null}>
      {!visible && (
        <p role="status" className="text-sm text-ink-3">
          {labels.loading}
        </p>
      )}
      {visible?.failed && (
        <div className="flex items-center gap-3">
          <p role="alert">{labels.failed}</p>
          <Button
            variant="outline"
            size="icon"
            title={labels.retry}
            aria-label={labels.retry}
            onClick={reload}
          >
            <RotateCw />
          </Button>
        </div>
      )}
      {visible?.items?.length === 0 && (
        <p className="text-sm text-ink-3">{empty}</p>
      )}
      {visible?.items
        ?.slice(0, PAGE_SIZE)
        .map((item) => children(item, reload))}
      {(page > 0 || (visible?.items?.length ?? 0) > PAGE_SIZE) && (
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="icon"
            title={labels.previous}
            aria-label={labels.previous}
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon"
            title={labels.next}
            aria-label={labels.next}
            disabled={(visible?.items?.length ?? 0) <= PAGE_SIZE}
            onClick={() => setPage(page + 1)}
          >
            <ChevronRight />
          </Button>
        </div>
      )}
    </div>
  );
}

export default function KnowledgePage() {
  const { t } = useI18n();
  const labels = t.knowledge;
  return (
    <div className="space-y-4">
      <PageHeader title={labels.title} />
      <Tabs defaultValue="published">
        <TabsList aria-label={labels.title}>
          <TabsTrigger value="published">{labels.published}</TabsTrigger>
          <TabsTrigger value="pending">{labels.pending}</TabsTrigger>
        </TabsList>
        <TabsContent value="published">
          <KnowledgeList<KnowledgeItem>
            path="/knowledge/items"
            empty={labels.emptyPublished}
          >
            {(item) => <PublishedItem key={item.id} item={item} />}
          </KnowledgeList>
        </TabsContent>
        <TabsContent value="pending">
          <KnowledgeList<Proposal>
            path="/knowledge/proposals"
            empty={labels.emptyPending}
          >
            {(item, reload) => (
              <ProposalReview key={item.id} proposal={item} done={reload} />
            )}
          </KnowledgeList>
        </TabsContent>
      </Tabs>
    </div>
  );
}
