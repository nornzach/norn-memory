"use client";

import {
  FormEvent,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  SlidersHorizontal,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchInput } from "@/components/ui/search-input";
import { CopyButton } from "@/components/misc/copy-button";
import { DataTable } from "@/components/shared/data-table";
import { Field } from "@/components/shared/field";
import { FilterBar, PageHeader, Panel } from "@/components/shared/page";
import { Pager } from "@/components/shared/pager";
import { TableSkeleton } from "@/components/shared/table-skeleton";
import { EmptyState } from "@/components/self-hosted/empty-state";
import {
  SourceCell,
  SourceDetails,
} from "@/components/self-hosted/source-details";
import DeleteConfirmationModal from "@/components/ui/delete-confirmation-modal";
import { toast } from "@/components/ui/use-toast";
import { getErrorMessage } from "@/lib/error-message";
import { cn } from "@/lib/utils";
import { api } from "@/utils/api";
import { ENTITY_ENDPOINTS, EXACT_ENDPOINTS } from "@/utils/api-endpoints";
import { useApiQuery } from "@/hooks/use-api-query";
import useDebounce from "@/hooks/useDebounce";
import {
  EXACT_KINDS,
  Entity,
  ExactHistory,
  ExactRecord,
  ExactRecordVersion,
} from "@/types/api";
import { useI18n } from "@/i18n/provider";

const PAGE_SIZE = 50;
const HISTORY_LIMIT = 50;
const ALL_KINDS = "__all__";
const USER_STORAGE_KEY = "norn_m.exact.userId";
// Masking is display only: values are stored and sent in plaintext by design.
const SECRET_FIELD_RE =
  /pass|pwd|secret|token|api[-_ ]?key|private|credential|otp|seed|mnemonic|cvv|cvc|(^|[-_ ])pin($|[-_ ])/i;
// -webkit-text-security masks a textarea like a password input but keeps newlines
// (private keys) and does not invite the browser's password manager.
const MASKED_TEXT = "[-webkit-text-security:disc]";

const isSecretField = (name: string) => SECRET_FIELD_RE.test(name);

// Field values are any JSON; strings are shown as stored, everything else as JSON.
const displayValue = (value: unknown) =>
  typeof value === "string" ? value : JSON.stringify(value, null, 2);

const lineCount = (text: string) => Math.min(8, text.split("\n").length);

const readStoredUser = () => {
  try {
    return localStorage.getItem(USER_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
};

const storeUser = (userId: string) => {
  try {
    localStorage.setItem(USER_STORAGE_KEY, userId);
  } catch {
    // Private windows can refuse storage; the selection just isn't remembered.
  }
};

const EMPTY_PAGE: RecordPage = { records: [], hasMore: false };

interface RecordPage {
  records: ExactRecord[];
  hasMore: boolean;
}

function RevealButton({
  name,
  revealed,
  onToggle,
  className,
}: {
  name: string;
  revealed: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  const label = revealed ? t.exact.hide(name) : t.exact.show(name);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn("size-8 shrink-0 text-ink-3", className)}
      aria-label={label}
      title={label}
      aria-pressed={revealed}
      onClick={onToggle}
    >
      {revealed ? (
        <EyeOff className="size-4" aria-hidden />
      ) : (
        <Eye className="size-4" aria-hidden />
      )}
    </Button>
  );
}

function FieldList({ fields }: { fields: Record<string, unknown> }) {
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const { t } = useI18n();
  const entries = Object.entries(fields);

  if (entries.length === 0) {
    return <p className="text-sm text-ink-3">{t.exact.noFields}</p>;
  }

  const toggle = (name: string) =>
    setRevealed((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <dl className="divide-y divide-line overflow-hidden rounded-lg border border-line">
      {entries.map(([name, value]) => {
        const text = displayValue(value);
        const secret = isSecretField(name);
        const hidden = secret && !revealed.has(name);
        return (
          <div key={name} className="flex items-start gap-1 py-2 pl-3 pr-1.5">
            <div className="min-w-0 flex-1 space-y-0.5 py-0.5">
              <dt className="break-all font-mono text-xs text-ink-3">{name}</dt>
              <dd>
                <pre className="whitespace-pre-wrap break-all font-mono text-[13px] leading-5 text-ink">
                  {hidden ? "••••••••" : text}
                </pre>
              </dd>
            </div>
            {secret && (
              <RevealButton
                name={name}
                revealed={!hidden}
                onToggle={() => toggle(name)}
              />
            )}
            <CopyButton
              text={text}
              label={t.exact.copy(name)}
              className="size-8 shrink-0 text-ink-3"
            />
          </div>
        );
      })}
    </dl>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium text-ink-3">{title}</h3>
      {children}
    </section>
  );
}

function RecordSummary({
  record,
}: {
  record: Pick<ExactRecord, "kind" | "title" | "description" | "tags"> & {
    fields: Record<string, unknown>;
  };
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {record.kind && (
          <Badge variant="outline" className="font-mono">
            {record.kind}
          </Badge>
        )}
        {record.title && (
          <span className="min-w-0 break-words text-[15px] font-medium text-ink">
            {record.title}
          </span>
        )}
      </div>
      {record.description && (
        <Section title={t.exact.descriptionLabel}>
          <p className="whitespace-pre-wrap break-words text-sm leading-6 text-ink-2">
            {record.description}
          </p>
        </Section>
      )}
      <Section title={t.exact.fieldsLabel}>
        <FieldList fields={record.fields} />
      </Section>
      <Section title={t.exact.tagsLabel}>
        {record.tags.length ? (
          <div className="flex flex-wrap gap-1.5">
            {record.tags.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-sm text-ink-3">{t.exact.noTags}</p>
        )}
      </Section>
    </div>
  );
}

function HistoryList({
  userId,
  recordKey,
  version,
}: {
  userId: string;
  recordKey: string;
  version: number;
}) {
  const { t, dateLocale } = useI18n();
  const { data, error, refetch } = useApiQuery<ExactHistory>(
    async () => {
      const res = await api.get<ExactHistory>(
        EXACT_ENDPOINTS.HISTORY(recordKey),
        { params: { user_id: userId, limit: HISTORY_LIMIT } },
      );
      return res.data;
    },
    { errorToast: t.exact.historyLoadFailed, enabled: false },
  );

  // Reload when the record is saved while the tab is open.
  useEffect(() => {
    void refetch();
  }, [userId, recordKey, version, refetch]);

  if (!data) {
    return error ? (
      <p className="text-sm text-danger">{error}</p>
    ) : (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    );
  }

  const versions: ExactRecordVersion[] = data.versions;
  if (versions.length === 0) {
    return <p className="text-sm text-ink-3">{t.exact.noHistory}</p>;
  }

  return (
    <ol className="space-y-3">
      {versions.map((entry) => (
        <li
          key={`${entry.version}-${entry.replaced_at}`}
          className="space-y-4 rounded-lg border border-line p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold text-ink">
              {t.exact.versionLabel(entry.version)}
            </span>
            <span className="flex items-center gap-2 text-xs text-ink-3">
              <Badge
                variant={entry.change === "delete" ? "destructive" : "info"}
              >
                {entry.change === "delete"
                  ? t.exact.changeDelete
                  : t.exact.changeUpdate}
              </Badge>
              {entry.replaced_at &&
                format(new Date(entry.replaced_at), t.common.dateTimeFormat, {
                  locale: dateLocale,
                })}
            </span>
          </div>
          <RecordSummary
            record={{
              kind: entry.kind ?? "",
              title: entry.title ?? null,
              description: entry.description ?? null,
              tags: entry.tags ?? [],
              fields: entry.fields ?? {},
            }}
          />
        </li>
      ))}
    </ol>
  );
}

interface FieldRow {
  id: number;
  name: string;
  value: string;
  // The stored value, so a JSON number or object left untouched is saved as it was.
  original?: unknown;
  revealed: boolean;
}

const makeRow = (
  id: number,
  name = "",
  value: unknown = undefined,
): FieldRow => ({
  id,
  name,
  value: value === undefined ? "" : displayValue(value),
  original: value,
  revealed: false,
});

function RecordDialog({
  open,
  record,
  userId,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  record: ExactRecord | null;
  userId: string;
  onOpenChange: (open: boolean) => void;
  onSaved: (record: ExactRecord) => void;
}) {
  const { t } = useI18n();
  const nextRowId = useRef(0);
  const saved = useRef(false);
  const [key, setKey] = useState("");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [rows, setRows] = useState<FieldRow[]>([]);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setKey(record?.key ?? "");
    setTitle(record?.title ?? "");
    setKind(record?.kind ?? "");
    setDescription(record?.description ?? "");
    setTags((record?.tags ?? []).join(", "));
    const entries = Object.entries(record?.fields ?? {});
    setRows(
      entries.length
        ? entries.map(([name, value]) =>
            makeRow(nextRowId.current++, name, value),
          )
        : [makeRow(nextRowId.current++)],
    );
    setError("");
  }, [open, record]);

  const updateRow = (id: number, change: Partial<FieldRow>) =>
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...change } : row)),
    );

  const buildFields = (): [string, unknown][] | string => {
    const entries: [string, unknown][] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const name = row.name.trim();
      if (!name && !row.value) continue;
      if (!name) return t.exact.fieldNameRequired;
      if (seen.has(name)) return t.exact.duplicateField(name);
      seen.add(name);
      const untouched =
        row.original !== undefined &&
        typeof row.original !== "string" &&
        row.value === displayValue(row.original);
      entries.push([name, untouched ? row.original : row.value]);
    }
    return entries;
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    if (isSaving) return;
    if (!record && !key.trim()) {
      setError(t.exact.keyRequired);
      return;
    }
    const fields = buildFields();
    if (typeof fields === "string") {
      setError(fields);
      return;
    }
    setError("");
    setIsSaving(true);
    try {
      const res = await api.put<ExactRecord & { result: string }>(
        EXACT_ENDPOINTS.RECORD(record?.key ?? key.trim()),
        {
          user_id: userId,
          kind: kind.trim() || null,
          title: title.trim() || null,
          description: description || null,
          tags: tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
          // fromEntries keeps a field literally named "__proto__" as data.
          fields: Object.fromEntries(fields),
          merge: false,
          // 0 means "only if new", so creating never overwrites an existing key.
          if_version: record ? record.version : 0,
        },
      );
      const { result, ...savedRecord } = res.data;
      toast({
        title:
          result === "created"
            ? t.exact.recordCreated
            : result === "unchanged"
              ? t.exact.unchanged
              : t.exact.recordUpdated,
        variant: "success",
      });
      saved.current = true;
      onSaved(savedRecord);
    } catch (err) {
      setError(getErrorMessage(err, t.exact.saveFailed));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-2xl"
        onCloseAutoFocus={(event) => {
          // After a save the detail sheet opens; moving focus back to the button
          // that opened this dialog would count as a click outside and close it.
          if (saved.current) event.preventDefault();
          saved.current = false;
        }}
      >
        <form onSubmit={handleSave} className="space-y-5">
          <DialogHeader>
            <DialogTitle>
              {record ? t.exact.editTitle : t.exact.createTitle}
            </DialogTitle>
            <DialogDescription>
              {record ? t.exact.editDescription : t.exact.createDescription}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="exact-key" label={t.exact.keyLabel}>
              <Input
                id="exact-key"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={t.exact.keyPlaceholder}
                disabled={!!record}
                className="font-mono"
                autoComplete="off"
                autoFocus={!record}
              />
            </Field>
            <Field id="exact-kind" label={t.exact.kindLabel}>
              <Input
                id="exact-kind"
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                placeholder="note"
                list="exact-kind-options"
                className="font-mono"
                autoComplete="off"
              />
              <datalist id="exact-kind-options">
                {EXACT_KINDS.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
            </Field>
            <Field
              id="exact-title"
              label={t.exact.titleLabel}
              className="sm:col-span-2"
            >
              <Input
                id="exact-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t.exact.titlePlaceholder}
                autoComplete="off"
              />
            </Field>
          </div>

          <fieldset className="space-y-2">
            <legend className="mb-2 text-[13px] font-medium text-ink-2">
              {t.exact.fieldsLabel}
            </legend>
            <ul className="space-y-2">
              {rows.map((row) => {
                const secret = isSecretField(row.name);
                const hidden = secret && !row.revealed;
                return (
                  <li
                    key={row.id}
                    className="flex flex-col gap-2 rounded-lg border border-line bg-sunken p-2 sm:flex-row sm:items-start sm:border-0 sm:bg-transparent sm:p-0"
                  >
                    <div className="flex items-center gap-1 sm:contents">
                      <Input
                        value={row.name}
                        onChange={(e) =>
                          updateRow(row.id, { name: e.target.value })
                        }
                        placeholder={t.exact.fieldName}
                        aria-label={t.exact.fieldName}
                        className="min-w-0 flex-1 font-mono sm:w-44 sm:flex-none"
                        autoComplete="off"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-9 shrink-0 text-ink-3 hover:bg-danger-soft hover:text-danger sm:order-last"
                        aria-label={t.exact.removeField(row.name)}
                        onClick={() =>
                          setRows((current) =>
                            current.filter((r) => r.id !== row.id),
                          )
                        }
                      >
                        <X className="size-4" aria-hidden />
                      </Button>
                    </div>
                    <div className="flex min-w-0 flex-1 items-start gap-1">
                      <Textarea
                        value={row.value}
                        onChange={(e) =>
                          updateRow(row.id, { value: e.target.value })
                        }
                        placeholder={t.exact.fieldValue}
                        aria-label={t.exact.fieldValue}
                        rows={lineCount(row.value)}
                        spellCheck={false}
                        autoComplete="off"
                        className={cn(
                          "h-auto min-h-9 flex-1 resize-y py-2 font-mono",
                          hidden && MASKED_TEXT,
                        )}
                      />
                      {secret && (
                        <RevealButton
                          name={row.name}
                          revealed={!hidden}
                          onToggle={() =>
                            updateRow(row.id, { revealed: !row.revealed })
                          }
                          className="size-9"
                        />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setRows((current) => [...current, makeRow(nextRowId.current++)])
              }
            >
              <Plus aria-hidden /> {t.exact.addField}
            </Button>
          </fieldset>

          <div className="grid grid-cols-1 gap-4">
            <Field id="exact-description" label={t.exact.descriptionLabel}>
              <Textarea
                id="exact-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="min-h-[80px]"
              />
            </Field>
            <Field id="exact-tags" label={t.exact.tagsLabel}>
              <Input
                id="exact-tags"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder={t.exact.tagsPlaceholder}
                autoComplete="off"
              />
            </Field>
          </div>

          {error && (
            <p
              className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger"
              role="alert"
            >
              {error}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t.common.cancel}
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving && <Loader2 className="animate-spin" aria-hidden />}
              {isSaving
                ? t.common.saving
                : record
                  ? t.common.save
                  : t.common.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Filters behind "More filters": where a record came from, and which keys it is under.
type SourceField = "prefix" | "project" | "device" | "agent" | "cwd";
const SOURCE_FIELDS: SourceField[] = [
  "prefix",
  "project",
  "device",
  "agent",
  "cwd",
];
const NO_SOURCE: Record<SourceField, string> = {
  prefix: "",
  project: "",
  device: "",
  agent: "",
  cwd: "",
};

export default function ExactRecordsPage() {
  const [userInput, setUserInput] = useState("");
  const [userId, setUserId] = useState("");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState(ALL_KINDS);
  const [tag, setTag] = useState("");
  const [source, setSource] = useState(NO_SOURCE);
  const [showMore, setShowMore] = useState(false);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<ExactRecord | null>(null);
  const [sheetTab, setSheetTab] = useState("fields");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ExactRecord | null>(null);
  const [recordToDelete, setRecordToDelete] = useState<ExactRecord | null>(
    null,
  );
  const debouncedQuery = useDebounce(query.trim(), 300);
  const debouncedTag = useDebounce(tag.trim(), 300);
  const debouncedSource = useDebounce(source, 300);
  const latestRequest = useRef(0);
  const lastPage = useRef<RecordPage>(EMPTY_PAGE);
  const { t, dateLocale } = useI18n();

  const { data: entities = [] } = useApiQuery<Entity[]>(
    async () => {
      const res = await api.get<Entity[]>(ENTITY_ENDPOINTS.BASE);
      return res.data ?? [];
    },
    { initialData: [] },
  );
  const users = useMemo(
    () => entities.filter((e) => e.type === "user"),
    [entities],
  );

  // Default to the last user picked here, else the first user with memories.
  useEffect(() => {
    if (userId) return;
    const initial = readStoredUser() || users[0]?.id || "";
    if (initial) {
      setUserId(initial);
      setUserInput(initial);
    }
  }, [users, userId]);

  const {
    data: { records, hasMore } = EMPTY_PAGE,
    isLoading,
    refetch,
  } = useApiQuery<RecordPage>(
    async () => {
      const request = ++latestRequest.current;
      const params: Record<string, string | number> = {
        user_id: userId,
        // One extra row tells whether there is a next page.
        limit: PAGE_SIZE + 1,
        offset: page * PAGE_SIZE,
      };
      if (debouncedQuery) params.q = debouncedQuery;
      if (kind !== ALL_KINDS) params.kind = kind;
      if (debouncedTag) params.tag = debouncedTag;
      for (const field of SOURCE_FIELDS) {
        const value = debouncedSource[field].trim();
        if (value) params[field] = value;
      }
      const res = await api.get<{ results: ExactRecord[] }>(
        EXACT_ENDPOINTS.RECORDS,
        { params },
      );
      // A slower, older search must not overwrite the newer one's results.
      if (request !== latestRequest.current) return lastPage.current;
      const results = res.data?.results ?? [];
      lastPage.current = {
        records: results.slice(0, PAGE_SIZE),
        hasMore: results.length > PAGE_SIZE,
      };
      return lastPage.current;
    },
    { errorToast: t.exact.loadFailed, enabled: false },
  );

  useEffect(() => {
    if (userId) void refetch();
  }, [
    userId,
    debouncedQuery,
    kind,
    debouncedTag,
    debouncedSource,
    page,
    refetch,
  ]);

  const commitUser = () => {
    const next = userInput.trim();
    if (!next || next === userId) return;
    storeUser(next);
    setUserId(next);
    setPage(0);
    setSelected(null);
  };

  const kindOptions = Array.from(
    new Set([
      ...EXACT_KINDS,
      ...records.map((r) => r.kind),
      ...(kind === ALL_KINDS ? [] : [kind]),
    ]),
  );

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (record: ExactRecord) => {
    setEditing(record);
    setDialogOpen(true);
  };

  const openRecord = (record: ExactRecord) => {
    setSelected(record);
    setSheetTab("fields");
  };

  const handleSaved = (record: ExactRecord) => {
    setDialogOpen(false);
    setSelected(record);
    void refetch();
  };

  const handleDelete = async () => {
    if (!recordToDelete) return;
    try {
      await api.delete(EXACT_ENDPOINTS.RECORD(recordToDelete.key), {
        params: { user_id: userId },
      });
      toast({ title: t.exact.deleted, variant: "success" });
      if (selected?.key === recordToDelete.key) setSelected(null);
      setRecordToDelete(null);
      void refetch();
    } catch (error) {
      toast({
        title: t.exact.deleteFailed,
        description: getErrorMessage(error),
        variant: "destructive",
      });
    }
  };

  const formatWhen = (value: string | null) =>
    value
      ? format(new Date(value), t.common.dateTimeFormat, { locale: dateLocale })
      : t.common.none;

  const relative = (value: string | null) =>
    value
      ? formatDistanceToNow(new Date(value), {
          addSuffix: true,
          locale: dateLocale,
        })
      : t.common.none;

  const columns = [
    {
      key: "key" as keyof ExactRecord,
      label: t.exact.columns.key,
      width: 220,
      render: (value: string) => (
        <code
          className="block truncate font-mono text-[13px] text-ink"
          title={value}
        >
          {value}
        </code>
      ),
    },
    {
      key: "kind" as keyof ExactRecord,
      label: t.exact.columns.kind,
      width: 100,
      render: (value: string) => (
        <Badge variant="outline" className="font-mono">
          {value}
        </Badge>
      ),
    },
    {
      key: "title" as keyof ExactRecord,
      label: t.exact.columns.title,
      width: "auto" as const,
      render: (value: string | null) => (
        <span
          className={cn("block truncate", !value && "text-ink-3")}
          title={value ?? ""}
        >
          {value || t.common.none}
        </span>
      ),
    },
    {
      key: "tags" as keyof ExactRecord,
      label: t.exact.columns.tags,
      width: 160,
      hideBelow: "xl" as const,
      render: (value: string[]) => (
        <div
          className="flex items-center gap-1 overflow-hidden"
          title={value.join(", ")}
        >
          {value.slice(0, 2).map((item) => (
            <Badge key={item} variant="secondary">
              {item}
            </Badge>
          ))}
          {value.length > 2 && (
            <span className="text-xs text-ink-3">+{value.length - 2}</span>
          )}
        </div>
      ),
    },
    {
      key: "project" as keyof ExactRecord,
      label: t.source.column,
      width: 140,
      hideBelow: "xl" as const,
      render: (_: unknown, row: ExactRecord) => <SourceCell source={row} />,
    },
    {
      key: "updated_at" as keyof ExactRecord,
      label: t.exact.columns.updated,
      width: 130,
      render: (value: string | null) => (
        <span className="text-ink-3" title={formatWhen(value)}>
          {relative(value)}
        </span>
      ),
    },
  ];

  const activeSourceFilters = SOURCE_FIELDS.filter((f) =>
    debouncedSource[f].trim(),
  ).length;
  const filtered =
    !!debouncedQuery ||
    kind !== ALL_KINDS ||
    !!debouncedTag ||
    activeSourceFilters > 0;

  const clearFilters = () => {
    setQuery("");
    setKind(ALL_KINDS);
    setTag("");
    setSource(NO_SOURCE);
    setPage(0);
  };

  const sourcePlaceholders: Record<SourceField, string> = {
    prefix: t.exact.prefixPlaceholder,
    project: t.source.project,
    device: t.source.device,
    agent: t.source.agent,
    cwd: t.exact.folderPlaceholder,
  };

  return (
    <>
      <PageHeader
        title={t.exact.title}
        description={t.exact.subtitle}
        actions={
          <Button onClick={openCreate} disabled={!userId}>
            <Plus aria-hidden /> {t.exact.add}
          </Button>
        }
      />

      <Panel>
        <FilterBar>
          <div className="relative xs:col-span-2 md:w-44">
            <UserRound
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3"
              aria-hidden
            />
            <Input
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              onBlur={commitUser}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitUser();
              }}
              placeholder={t.exact.userPlaceholder}
              aria-label={t.exact.userLabel}
              list="exact-user-options"
              className="pl-9"
              autoComplete="off"
            />
            <datalist id="exact-user-options">
              {users.map((user) => (
                <option key={user.id} value={user.id} />
              ))}
            </datalist>
          </div>
          <SearchInput
            value={query}
            onValueChange={(value) => {
              setQuery(value);
              setPage(0);
            }}
            placeholder={t.exact.searchPlaceholder}
            aria-label={t.exact.searchPlaceholder}
            containerClassName="xs:col-span-2 md:min-w-[180px] md:flex-1"
            disabled={!userId}
          />
          <Select
            value={kind}
            onValueChange={(value) => {
              setKind(value);
              setPage(0);
            }}
            disabled={!userId}
          >
            <SelectTrigger className="md:w-32" aria-label={t.exact.kindFilter}>
              <SelectValue placeholder={t.exact.allKinds} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_KINDS}>{t.exact.allKinds}</SelectItem>
              {kindOptions.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={tag}
            onChange={(e) => {
              setTag(e.target.value);
              setPage(0);
            }}
            placeholder={t.exact.tagPlaceholder}
            aria-label={t.exact.tagPlaceholder}
            className="md:w-28"
            autoComplete="off"
            disabled={!userId}
          />
          <Button
            variant="outline"
            onClick={() => setShowMore((v) => !v)}
            aria-expanded={showMore}
            disabled={!userId}
            className={cn(
              "shrink-0",
              activeSourceFilters > 0 && "border-brand text-brand-text",
            )}
          >
            <SlidersHorizontal aria-hidden />
            {t.memories.moreFilters}
            {activeSourceFilters > 0 && (
              <span className="tabular grid size-5 place-items-center rounded-full bg-brand-soft text-xs">
                {activeSourceFilters}
              </span>
            )}
          </Button>
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="justify-self-start text-ink-3 md:ml-auto"
            >
              <X aria-hidden />
              {t.common.clearFilters}
            </Button>
          )}
        </FilterBar>

        {showMore && userId && (
          <div className="grid grid-cols-1 gap-2 border-b border-line bg-subtle/40 px-5 py-3 xs:grid-cols-2 sm:px-6 lg:grid-cols-3 2xl:grid-cols-5">
            {SOURCE_FIELDS.map((field) => (
              <Input
                key={field}
                value={source[field]}
                onChange={(e) => {
                  const value = e.target.value;
                  setSource((current) => ({ ...current, [field]: value }));
                  setPage(0);
                }}
                placeholder={sourcePlaceholders[field]}
                aria-label={sourcePlaceholders[field]}
                className={cn(field === "prefix" && "font-mono")}
                autoComplete="off"
              />
            ))}
          </div>
        )}

        {!userId ? (
          <EmptyState
            title={t.exact.chooseUserTitle}
            description={t.exact.chooseUserDescription}
            icon={UserRound}
          />
        ) : isLoading && records.length === 0 ? (
          <TableSkeleton rows={5} columns={5} />
        ) : records.length === 0 ? (
          <EmptyState
            title={filtered ? t.exact.noMatchesTitle : t.exact.emptyTitle}
            description={
              filtered ? t.exact.noMatchesDescription : t.exact.emptyDescription
            }
            icon={KeyRound}
          >
            {filtered ? (
              <Button variant="outline" onClick={clearFilters}>
                {t.common.clearFilters}
              </Button>
            ) : (
              <Button onClick={openCreate}>
                <Plus aria-hidden /> {t.exact.add}
              </Button>
            )}
          </EmptyState>
        ) : (
          <>
            <DataTable
              data={records}
              columns={columns}
              getRowKey={(row) => row.id}
              onRowClick={openRecord}
              getRowLabel={(row) => row.title || row.key}
              getRowClassName={(row) =>
                selected?.id === row.id ? "bg-brand-soft" : undefined
              }
              renderMobileCard={(row) => (
                <div className="flex min-w-0 flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 truncate font-mono text-[13px] font-medium text-ink">
                      {row.key}
                    </code>
                    <Badge variant="outline" className="shrink-0 font-mono">
                      {row.kind}
                    </Badge>
                  </div>
                  {row.title && (
                    <p className="truncate text-sm text-ink-2">{row.title}</p>
                  )}
                  <p className="truncate text-xs text-ink-3">
                    {[
                      row.tags.length ? row.tags.join(", ") : null,
                      relative(row.updated_at),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
              )}
            />
            <Pager
              page={page}
              pageSize={PAGE_SIZE}
              shown={records.length}
              hasMore={hasMore}
              onPageChange={setPage}
              disabled={isLoading}
            />
          </>
        )}
      </Panel>

      <Sheet
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <SheetContent className="w-full gap-0 p-0 sm:max-w-lg">
          <SheetHeader className="border-b border-line px-5 py-4 sm:px-6">
            <SheetTitle className="break-all pr-8 font-mono text-[15px]">
              {selected?.key}
            </SheetTitle>
            <SheetDescription className="sr-only">
              {t.exact.detailDescription}
            </SheetDescription>
          </SheetHeader>
          {selected && (
            <>
              <Tabs
                value={sheetTab}
                onValueChange={setSheetTab}
                className="flex min-h-0 flex-1 flex-col"
              >
                <div className="border-b border-line px-5 py-2 sm:px-6">
                  <TabsList>
                    <TabsTrigger value="fields">
                      {t.exact.fieldsTab}
                    </TabsTrigger>
                    <TabsTrigger value="history">
                      {t.exact.historyTab}
                    </TabsTrigger>
                  </TabsList>
                </div>
                <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
                  <TabsContent value="fields" className="mt-0 space-y-6">
                    <RecordSummary
                      key={`${selected.id}-${selected.version}`}
                      record={selected}
                    />
                    <SourceDetails source={selected} />
                    <dl className="grid grid-cols-3 gap-3 rounded-lg bg-sunken px-3 py-3 text-xs">
                      <div className="min-w-0 space-y-0.5">
                        <dt className="text-ink-3">{t.exact.version}</dt>
                        <dd className="tabular font-medium text-ink">
                          {selected.version}
                        </dd>
                      </div>
                      <div className="min-w-0 space-y-0.5">
                        <dt className="text-ink-3">{t.exact.created}</dt>
                        <dd className="text-ink-2">
                          {formatWhen(selected.created_at)}
                        </dd>
                      </div>
                      <div className="min-w-0 space-y-0.5">
                        <dt className="text-ink-3">{t.exact.updated}</dt>
                        <dd className="text-ink-2">
                          {formatWhen(selected.updated_at)}
                        </dd>
                      </div>
                    </dl>
                  </TabsContent>
                  <TabsContent value="history" className="mt-0">
                    {sheetTab === "history" && (
                      <HistoryList
                        key={selected.key}
                        userId={userId}
                        recordKey={selected.key}
                        version={selected.version}
                      />
                    )}
                  </TabsContent>
                </div>
              </Tabs>
              <div className="flex shrink-0 items-center justify-between gap-2 border-t border-line px-5 py-3 sm:px-6">
                <Button
                  variant="ghost"
                  className="text-danger hover:bg-danger-soft hover:text-danger"
                  onClick={() => setRecordToDelete(selected)}
                >
                  <Trash2 aria-hidden />
                  {t.exact.deleteRecord}
                </Button>
                <Button variant="outline" onClick={() => openEdit(selected)}>
                  <Pencil aria-hidden />
                  {t.common.edit}
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <RecordDialog
        open={dialogOpen}
        record={editing}
        userId={userId}
        onOpenChange={setDialogOpen}
        onSaved={handleSaved}
      />

      <DeleteConfirmationModal
        isOpen={!!recordToDelete}
        onClose={() => setRecordToDelete(null)}
        onConfirm={handleDelete}
        title={t.exact.deleteTitle}
        description={t.exact.deleteDescription}
        itemName={recordToDelete?.key ?? ""}
        confirmButtonText={t.common.delete}
      />
    </>
  );
}
