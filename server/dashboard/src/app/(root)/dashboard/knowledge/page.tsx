"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

export default function KnowledgePage() {
  const { t } = useI18n();
  const labels = t.knowledge;
  const [user, setUser] = useState("");
  const [items, setItems] = useState<Proposal[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function load(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setItems(null);
    try {
      const { data } = await api.get<Proposal[]>("/knowledge/proposals", {
        params: { user_id: user.trim() },
      });
      setItems(data);
    } catch (failure) {
      setError(getErrorMessage(failure, labels.failed));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title={labels.title} description={labels.subtitle} />
      <form className="flex flex-wrap items-end gap-2" onSubmit={load}>
        <label>
          {labels.userId}
          <Input
            value={user}
            required
            onChange={(event) => setUser(event.target.value)}
          />
        </label>
        <Button type="submit" disabled={loading || !user.trim()}>
          {labels.load}
        </Button>
      </form>
      {error && <p role="alert">{error}</p>}
      {items?.length === 0 && <p>{labels.empty}</p>}
      {items?.map((item) => (
        <ProposalReview
          key={item.id}
          proposal={item}
          done={() =>
            setItems(
              (old) => old?.filter((entry) => entry.id !== item.id) ?? null,
            )
          }
        />
      ))}
    </div>
  );
}
