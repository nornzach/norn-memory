"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { History, Loader2, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { CategoriesDisplay } from "@/components/ui/categories-display";
import { CopyButton } from "@/components/misc/copy-button";
import { DetailList, IdText } from "@/components/shared/page";
import { Spinner } from "@/components/misc/spinner";
import {
  SourceDetails,
  memorySource,
} from "@/components/self-hosted/source-details";
import { toast } from "@/components/ui/use-toast";
import { getErrorMessage } from "@/lib/error-message";
import { api } from "@/utils/api";
import { CATEGORY_ENDPOINTS, MEMORY_ENDPOINTS } from "@/utils/api-endpoints";
import { Category, Memory } from "@/types/api";
import { cn } from "@/lib/utils";
import { expiryOf, isExpired, todayUtc } from "@/lib/memory-expiry";
import { useI18n } from "@/i18n/provider";

interface HistoryEntry {
  id: string;
  old_memory: string | null;
  new_memory: string | null;
  event: string;
  created_at: string | null;
  updated_at: string | null;
}

// The admin listing returns categories at the top level; scoped listings keep them in metadata.
export const getCategories = (memory: Memory): string[] => {
  if (memory.categories?.length) return memory.categories;
  const fromMetadata = memory.metadata?.categories;
  return Array.isArray(fromMetadata) ? (fromMetadata as string[]) : [];
};

const EVENT_VARIANT: Record<string, "success" | "info" | "destructive"> = {
  ADD: "success",
  UPDATE: "info",
  DELETE: "destructive",
};

export function MemorySheet({
  memory,
  onClose,
  onDelete,
  onUpdated,
}: {
  memory: Memory | null;
  onClose: () => void;
  onDelete: (memory: Memory) => void;
  onUpdated: (memory: Memory) => void;
}) {
  const { t, dateLocale } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftCategories, setDraftCategories] = useState<string[]>([]);
  const [draftExpiry, setDraftExpiry] = useState("");
  const [allCategories, setAllCategories] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [historyError, setHistoryError] = useState("");

  const memoryId = memory?.id;

  useEffect(() => {
    setEditing(false);
    setHistory(null);
    setHistoryError("");
    if (!memoryId) return;
    let cancelled = false;
    api
      .get<HistoryEntry[]>(MEMORY_ENDPOINTS.HISTORY(memoryId))
      .then((res) => !cancelled && setHistory(res.data ?? []))
      .catch(
        (err) =>
          !cancelled &&
          setHistoryError(getErrorMessage(err, t.memories.historyFailed)),
      );
    return () => {
      cancelled = true;
    };
  }, [memoryId, t.memories.historyFailed]);

  const when = (value?: string | null) =>
    value
      ? format(new Date(value), t.common.dateTimeFormat, { locale: dateLocale })
      : t.common.none;
  // A bare YYYY-MM-DD read at local noon, so no time zone shifts it to the day before.
  const day = (value: string) =>
    format(new Date(`${value}T12:00:00`), t.common.dateFormat, {
      locale: dateLocale,
    });

  const startEditing = () => {
    if (!memory) return;
    setDraft(memory.memory);
    setDraftCategories(getCategories(memory));
    setDraftExpiry(expiryOf(memory) ?? "");
    setEditing(true);
    if (allCategories === null) {
      api
        .get<Category[]>(CATEGORY_ENDPOINTS.BASE)
        .then((res) => setAllCategories(res.data.map((c) => c.name)))
        .catch(() => setAllCategories([]));
    }
  };

  const toggleCategory = (name: string) =>
    setDraftCategories((current) =>
      current.includes(name)
        ? current.filter((c) => c !== name)
        : [...current, name],
    );

  const save = async () => {
    if (!memory || !draft.trim()) return;
    const text = draft.trim();
    const before = getCategories(memory);
    const textChanged = text !== memory.memory;
    const categoriesChanged =
      draftCategories.length !== before.length ||
      draftCategories.some((c) => !before.includes(c));
    const expiry = draftExpiry || null;
    const expiryChanged = expiry !== expiryOf(memory);
    if (!textChanged && !categoriesChanged && !expiryChanged) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await api.put(MEMORY_ENDPOINTS.BY_ID(memory.id), {
        ...(textChanged && { text }),
        ...(categoriesChanged && {
          metadata: { categories: draftCategories },
        }),
        ...(expiryChanged && { expiration_date: expiry }),
      });
      toast({ title: t.memories.updated, variant: "success" });
      setEditing(false);
      onUpdated({
        ...memory,
        memory: text,
        categories: draftCategories,
        expiration_date: expiry,
      });
      const res = await api.get<HistoryEntry[]>(
        MEMORY_ENDPOINTS.HISTORY(memory.id),
      );
      setHistory(res.data ?? []);
    } catch (err) {
      toast({
        title: t.memories.updateFailed,
        description: getErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const categories = memory ? getCategories(memory) : [];
  const expiry = memory ? expiryOf(memory) : null;

  return (
    <Sheet open={!!memory} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-line px-5 py-4 sm:px-6">
          <SheetTitle>{t.memories.detailTitle}</SheetTitle>
          <SheetDescription className="sr-only">
            {t.memories.detailDescription}
          </SheetDescription>
        </SheetHeader>

        {memory && (
          <>
            <div className="scrollbar-thin min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5 sm:px-6">
              <section aria-label={t.memories.columns.content}>
                {editing ? (
                  <div>
                    <Textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={5}
                      autoFocus
                      aria-label={t.memories.columns.content}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault();
                          void save();
                        }
                      }}
                    />
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap break-words text-[15px] leading-7 text-ink">
                    {memory.memory}
                  </p>
                )}
              </section>

              <section className="space-y-2">
                <h3 className="text-xs font-medium text-ink-3">
                  {t.memories.columns.categories}
                </h3>
                {editing ? (
                  allCategories === null ? (
                    <Spinner />
                  ) : allCategories.length === 0 &&
                    draftCategories.length === 0 ? (
                    <p className="text-sm text-ink-3">
                      {t.memories.noCategoriesDefined}
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {Array.from(
                        new Set([...allCategories, ...draftCategories]),
                      ).map((name) => {
                        const on = draftCategories.includes(name);
                        return (
                          <button
                            key={name}
                            type="button"
                            aria-pressed={on}
                            onClick={() => toggleCategory(name)}
                            className={cn(
                              "inline-flex h-7 items-center rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--focus)]",
                              on
                                ? "border-brand/40 bg-brand-soft text-brand-text"
                                : "border-line bg-panel text-ink-2 hover:bg-subtle",
                            )}
                          >
                            {name}
                          </button>
                        );
                      })}
                    </div>
                  )
                ) : categories.length ? (
                  <CategoriesDisplay
                    categories={categories}
                    showAllCategories
                  />
                ) : (
                  <p className="text-sm text-ink-3">
                    {t.memories.noCategories}
                  </p>
                )}
              </section>

              {editing && (
                <section className="space-y-2">
                  <label
                    htmlFor="memory-expiry"
                    className="text-xs font-medium text-ink-3"
                  >
                    {t.memories.expiryLabel}
                  </label>
                  <div className="flex gap-2">
                    <Input
                      id="memory-expiry"
                      type="date"
                      value={draftExpiry}
                      min={
                        draftExpiry && draftExpiry < todayUtc()
                          ? undefined
                          : todayUtc()
                      }
                      onChange={(e) => setDraftExpiry(e.target.value)}
                      className="max-w-[200px]"
                    />
                    {draftExpiry && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-9"
                        onClick={() => setDraftExpiry("")}
                      >
                        {t.memories.expiryClear}
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-ink-3">{t.memories.expiryHint}</p>
                </section>
              )}

              <DetailList
                items={[
                  {
                    label: t.memories.id,
                    wide: true,
                    value: (
                      <span className="flex items-center gap-1">
                        <IdText>{memory.id}</IdText>
                        <CopyButton
                          text={memory.id}
                          label={t.common.copyValue(t.memories.id)}
                          size="icon-xs"
                        />
                      </span>
                    ),
                  },
                  ...(memory.user_id
                    ? [
                        {
                          label: t.memories.columns.user,
                          value: memory.user_id,
                        },
                      ]
                    : []),
                  ...(memory.agent_id
                    ? [{ label: t.common.agentId, value: memory.agent_id }]
                    : []),
                  ...(memory.run_id
                    ? [{ label: t.common.runId, value: memory.run_id }]
                    : []),
                  {
                    label: t.memories.columns.created,
                    value: when(memory.created_at),
                  },
                  ...(memory.updated_at
                    ? [
                        {
                          label: t.memories.updatedAt,
                          value: when(memory.updated_at),
                        },
                      ]
                    : []),
                  {
                    label: t.memories.expiryLabel,
                    value: !expiry ? (
                      t.memories.expiryNever
                    ) : isExpired(memory) ? (
                      <Badge variant="warning">
                        {t.memories.expiredOn(day(expiry))}
                      </Badge>
                    ) : (
                      day(expiry)
                    ),
                  },
                ]}
              />

              <SourceDetails source={memorySource(memory)} />

              <section className="space-y-3">
                <h3 className="flex items-center gap-1.5 text-xs font-medium text-ink-3">
                  <History className="size-3.5" aria-hidden />
                  {t.memories.history}
                </h3>
                {historyError ? (
                  <p className="text-sm text-danger">{historyError}</p>
                ) : history === null ? (
                  <Spinner />
                ) : history.length === 0 ? (
                  <p className="text-sm text-ink-3">
                    {t.memories.historyEmpty}
                  </p>
                ) : (
                  <ol className="relative space-y-4 border-l border-line pl-4">
                    {[...history].reverse().map((entry) => (
                      <li key={entry.id} className="relative">
                        <span
                          className="absolute -left-[21px] top-1.5 size-2.5 rounded-full border-2 border-panel bg-line-strong"
                          aria-hidden
                        />
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant={EVENT_VARIANT[entry.event] ?? "secondary"}
                          >
                            {t.memories.events[entry.event] ?? entry.event}
                          </Badge>
                          <span className="text-xs text-ink-3">
                            {when(entry.updated_at ?? entry.created_at)}
                          </span>
                        </div>
                        {entry.event === "UPDATE" &&
                          entry.old_memory &&
                          entry.old_memory !== entry.new_memory && (
                            <p className="mt-1.5 text-sm text-ink-3 line-through decoration-ink-3/50">
                              {entry.old_memory}
                            </p>
                          )}
                        {entry.new_memory && entry.event !== "DELETE" && (
                          <p className="mt-1 text-sm text-ink-2">
                            {entry.new_memory}
                          </p>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </div>

            <div className="flex shrink-0 items-center justify-between gap-2 border-t border-line px-5 py-3 sm:px-6">
              {editing ? (
                <>
                  <p className="hidden text-xs text-ink-3 sm:block">
                    {t.memories.editHint}
                  </p>
                  <div className="ml-auto flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditing(false)}
                      disabled={saving}
                    >
                      {t.common.cancel}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => void save()}
                      disabled={saving || !draft.trim()}
                    >
                      {saving && (
                        <Loader2 className="animate-spin" aria-hidden />
                      )}
                      {t.memories.editSave}
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <Button
                    variant="destructive-ghost"
                    size="sm"
                    onClick={() => onDelete(memory)}
                  >
                    <Trash2 aria-hidden />
                    {t.memories.deleteMemory}
                  </Button>
                  <Button variant="outline" size="sm" onClick={startEditing}>
                    <Pencil aria-hidden />
                    {t.memories.edit}
                  </Button>
                </>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
