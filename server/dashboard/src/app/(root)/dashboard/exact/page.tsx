"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { CopyToClipboard } from "react-copy-to-clipboard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { DataTable } from "@/components/shared/data-table";
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
const USER_STORAGE_KEY = "mem0.exact.userId";
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

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const { t } = useI18n();
  return (
    <CopyToClipboard
      text={text}
      onCopy={() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      <Button
        variant="ghost"
        size="icon"
        className="size-7 shrink-0"
        aria-label={copied ? t.exact.copied : label}
        title={copied ? t.exact.copied : label}
      >
        {copied ? (
          <Check className="size-3.5" />
        ) : (
          <Copy className="size-3.5" />
        )}
      </Button>
    </CopyToClipboard>
  );
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
      className={cn("size-7 shrink-0", className)}
      aria-label={label}
      title={label}
      onClick={onToggle}
    >
      {revealed ? (
        <EyeOff className="size-3.5" />
      ) : (
        <Eye className="size-3.5" />
      )}
    </Button>
  );
}

function FieldList({ fields }: { fields: Record<string, unknown> }) {
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const { t } = useI18n();
  const entries = Object.entries(fields);

  if (entries.length === 0) {
    return (
      <p className="text-sm text-onSurface-default-tertiary">
        {t.exact.noFields}
      </p>
    );
  }

  const toggle = (name: string) =>
    setRevealed((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <div className="divide-y divide-memBorder-primary rounded-lg border border-memBorder-primary">
      {entries.map(([name, value]) => {
        const text = displayValue(value);
        const secret = isSecretField(name);
        const hidden = secret && !revealed.has(name);
        return (
          <div key={name} className="flex items-start gap-2 px-3 py-2">
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="text-xs text-onSurface-default-tertiary break-all">
                {name}
              </p>
              <pre className="whitespace-pre-wrap break-all font-mono text-sm text-onSurface-default-primary">
                {hidden ? "••••••••" : text}
              </pre>
            </div>
            {secret && (
              <RevealButton
                name={name}
                revealed={!hidden}
                onToggle={() => toggle(name)}
              />
            )}
            <CopyButton text={text} label={t.exact.copy(name)} />
          </div>
        );
      })}
    </div>
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="font-mono text-xs">
          {record.kind}
        </Badge>
        {record.title && (
          <span className="text-sm font-medium">{record.title}</span>
        )}
      </div>
      {record.description && (
        <div className="space-y-1">
          <Label className="text-xs text-onSurface-default-tertiary">
            {t.exact.descriptionLabel}
          </Label>
          <p className="whitespace-pre-wrap break-words text-sm">
            {record.description}
          </p>
        </div>
      )}
      <div className="space-y-1">
        <Label className="text-xs text-onSurface-default-tertiary">
          {t.exact.tagsLabel}
        </Label>
        {record.tags.length ? (
          <div className="flex flex-wrap gap-1">
            {record.tags.map((tag) => (
              <Badge key={tag} variant="outline" className="text-xs">
                {tag}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-sm text-onSurface-default-tertiary">
            {t.exact.noTags}
          </p>
        )}
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-onSurface-default-tertiary">
          {t.exact.fieldsLabel}
        </Label>
        <FieldList fields={record.fields} />
      </div>
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
      <p className="text-sm text-onSurface-danger-primary">{error}</p>
    ) : (
      <TableSkeleton rows={3} columns={1} />
    );
  }

  const versions: ExactRecordVersion[] = data.versions;
  if (versions.length === 0) {
    return (
      <p className="text-sm text-onSurface-default-tertiary">
        {t.exact.noHistory}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {versions.map((entry) => (
        <Card
          key={`${entry.version}-${entry.replaced_at}`}
          className="border-memBorder-primary p-4 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold">
              {t.exact.versionLabel(entry.version)}
            </span>
            <span className="text-xs text-onSurface-default-tertiary">
              {entry.change === "delete"
                ? t.exact.changeDelete
                : t.exact.changeUpdate}
              {entry.replaced_at &&
                ` · ${format(new Date(entry.replaced_at), t.common.dateTimeFormat, { locale: dateLocale })}`}
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
        </Card>
      ))}
    </div>
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

  const handleSave = async () => {
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
        className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
        onCloseAutoFocus={(event) => {
          // After a save the detail sheet opens; moving focus back to the button
          // that opened this dialog would count as a click outside and close it.
          if (saved.current) event.preventDefault();
          saved.current = false;
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {record ? t.exact.editTitle : t.exact.createTitle}
          </DialogTitle>
          <DialogDescription>
            {record ? t.exact.editDescription : t.exact.createDescription}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="exact-key">{t.exact.keyLabel}</Label>
              <Input
                id="exact-key"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={t.exact.keyPlaceholder}
                disabled={!!record}
                className="font-mono"
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="exact-kind">{t.exact.kindLabel}</Label>
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
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="exact-title">{t.exact.titleLabel}</Label>
            <Input
              id="exact-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t.exact.titlePlaceholder}
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="exact-description">
              {t.exact.descriptionLabel}
            </Label>
            <Textarea
              id="exact-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="h-20 resize-y"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="exact-tags">{t.exact.tagsLabel}</Label>
            <Input
              id="exact-tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder={t.exact.tagsPlaceholder}
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label>{t.exact.fieldsLabel}</Label>
            <div className="space-y-2">
              {rows.map((row) => {
                const secret = isSecretField(row.name);
                const hidden = secret && !row.revealed;
                return (
                  <div key={row.id} className="flex items-start gap-2">
                    <Input
                      value={row.name}
                      onChange={(e) =>
                        updateRow(row.id, { name: e.target.value })
                      }
                      placeholder={t.exact.fieldName}
                      aria-label={t.exact.fieldName}
                      className="w-36 shrink-0 font-mono sm:w-44"
                      autoComplete="off"
                    />
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
                        className="mt-1"
                      />
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0 mt-1"
                      aria-label={t.exact.removeField(row.name)}
                      onClick={() =>
                        setRows((current) =>
                          current.filter((r) => r.id !== row.id),
                        )
                      }
                    >
                      <X className="size-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setRows((current) => [...current, makeRow(nextRowId.current++)])
              }
            >
              <Plus className="size-3.5 mr-1" /> {t.exact.addField}
            </Button>
          </div>
          {error && (
            <p className="text-sm text-onSurface-danger-primary">{error}</p>
          )}
          <Button onClick={handleSave} disabled={isSaving} className="w-full">
            {isSaving
              ? t.common.saving
              : record
                ? t.common.save
                : t.common.create}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ExactRecordsPage() {
  const [userInput, setUserInput] = useState("");
  const [userId, setUserId] = useState("");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState(ALL_KINDS);
  const [tag, setTag] = useState("");
  const [project, setProject] = useState("");
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
  const debouncedProject = useDebounce(project.trim(), 300);
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
      if (debouncedProject) params.project = debouncedProject;
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
    debouncedProject,
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

  const columns = [
    {
      key: "key" as keyof ExactRecord,
      label: t.exact.columns.key,
      width: 200,
      render: (value: string) => (
        <code className="block truncate font-mono text-xs" title={value}>
          {value}
        </code>
      ),
    },
    {
      key: "kind" as keyof ExactRecord,
      label: t.exact.columns.kind,
      width: 90,
      render: (value: string) => (
        <Badge variant="outline" className="font-mono text-xs">
          {value}
        </Badge>
      ),
    },
    {
      key: "title" as keyof ExactRecord,
      label: t.exact.columns.title,
      width: 200,
      render: (value: string | null) => (
        <span className="block truncate" title={value ?? ""}>
          {value || t.common.none}
        </span>
      ),
    },
    {
      key: "tags" as keyof ExactRecord,
      label: t.exact.columns.tags,
      width: 140,
      render: (value: string[]) => (
        <div className="flex gap-1 overflow-hidden" title={value.join(", ")}>
          {value.slice(0, 3).map((item) => (
            <Badge key={item} variant="outline" className="text-xs">
              {item}
            </Badge>
          ))}
          {value.length > 3 && (
            <span className="text-xs text-onSurface-default-tertiary">
              +{value.length - 3}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "project" as keyof ExactRecord,
      label: t.source.column,
      width: 130,
      render: (_: unknown, row: ExactRecord) => <SourceCell source={row} />,
    },
    {
      key: "updated_at" as keyof ExactRecord,
      label: t.exact.columns.updated,
      width: 110,
      render: (value: string | null) =>
        value ? (
          <span
            className="text-xs text-onSurface-default-secondary"
            title={formatWhen(value)}
          >
            {formatDistanceToNow(new Date(value), {
              addSuffix: true,
              locale: dateLocale,
            })}
          </span>
        ) : (
          t.common.none
        ),
    },
  ];

  const filtered =
    !!debouncedQuery ||
    kind !== ALL_KINDS ||
    !!debouncedTag ||
    !!debouncedProject;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-72">
          <h1 className="text-xl font-semibold font-fustat">{t.exact.title}</h1>
          <p className="text-sm text-onSurface-default-secondary mt-1">
            {t.exact.subtitle}
          </p>
        </div>
        <Button size="sm" onClick={openCreate} disabled={!userId}>
          <Plus className="size-4 mr-1" /> {t.exact.add}
        </Button>
      </div>

      <div className="flex flex-wrap gap-3">
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
          className="w-full sm:w-48"
          autoComplete="off"
        />
        <datalist id="exact-user-options">
          {users.map((user) => (
            <option key={user.id} value={user.id} />
          ))}
        </datalist>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-onSurface-default-tertiary" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            placeholder={t.exact.searchPlaceholder}
            aria-label={t.exact.searchPlaceholder}
            className="pl-9"
            autoComplete="off"
          />
        </div>
        <Select
          value={kind}
          onValueChange={(value) => {
            setKind(value);
            setPage(0);
          }}
        >
          <SelectTrigger
            className="w-full sm:w-40"
            aria-label={t.exact.kindFilter}
          >
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
          className="w-full sm:w-32"
          autoComplete="off"
        />
        <Input
          value={project}
          onChange={(e) => {
            setProject(e.target.value);
            setPage(0);
          }}
          placeholder={t.source.projectFilter}
          aria-label={t.source.projectFilter}
          className="w-full sm:w-32"
          autoComplete="off"
        />
      </div>

      {!userId ? (
        <EmptyState
          title={t.exact.chooseUserTitle}
          description={t.exact.chooseUserDescription}
        />
      ) : isLoading && records.length === 0 ? (
        <TableSkeleton rows={5} columns={5} />
      ) : records.length === 0 ? (
        <EmptyState
          title={filtered ? t.exact.noMatchesTitle : t.exact.emptyTitle}
          description={
            filtered ? t.exact.noMatchesDescription : t.exact.emptyDescription
          }
        />
      ) : (
        <>
          <Card className="border-memBorder-primary overflow-hidden">
            <DataTable
              data={records}
              columns={columns}
              getRowKey={(row) => row.id}
              onRowClick={(row) => {
                setSelected(row);
                setSheetTab("fields");
              }}
              getRowClassName={(row) =>
                selected?.id === row.id
                  ? "bg-surface-default-tertiary"
                  : undefined
              }
            />
          </Card>
          {(page > 0 || hasMore) && (
            <div className="flex items-center justify-between text-sm text-onSurface-default-tertiary">
              <span>
                {t.exact.pageRange(
                  page * PAGE_SIZE + 1,
                  page * PAGE_SIZE + records.length,
                )}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                >
                  {t.common.previous}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!hasMore}
                  onClick={() => setPage((p) => p + 1)}
                >
                  {t.common.next}
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <Sheet
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle className="break-all pr-6 font-mono text-base">
              {selected?.key}
            </SheetTitle>
            <SheetDescription className="sr-only">
              {t.exact.detailDescription}
            </SheetDescription>
          </SheetHeader>
          {selected && (
            <Tabs value={sheetTab} onValueChange={setSheetTab} className="mt-4">
              <TabsList>
                <TabsTrigger value="fields">{t.exact.fieldsTab}</TabsTrigger>
                <TabsTrigger value="history">{t.exact.historyTab}</TabsTrigger>
              </TabsList>
              <TabsContent value="fields" className="mt-4 space-y-4">
                <RecordSummary
                  key={`${selected.id}-${selected.version}`}
                  record={selected}
                />
                <SourceDetails source={selected} />
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <Label className="text-xs text-onSurface-default-tertiary">
                      {t.exact.version}
                    </Label>
                    <p className="text-sm">{selected.version}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-onSurface-default-tertiary">
                      {t.exact.created}
                    </Label>
                    <p className="text-xs">{formatWhen(selected.created_at)}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-onSurface-default-tertiary">
                      {t.exact.updated}
                    </Label>
                    <p className="text-xs">{formatWhen(selected.updated_at)}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openEdit(selected)}
                  >
                    <Pencil className="size-3.5 mr-1" />
                    {t.common.edit}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-onSurface-danger-primary"
                    onClick={() => setRecordToDelete(selected)}
                  >
                    <Trash2 className="size-3.5 mr-1" />
                    {t.exact.deleteRecord}
                  </Button>
                </div>
              </TabsContent>
              <TabsContent value="history" className="mt-4">
                {sheetTab === "history" && (
                  <HistoryList
                    key={selected.key}
                    userId={userId}
                    recordKey={selected.key}
                    version={selected.version}
                  />
                )}
              </TabsContent>
            </Tabs>
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
    </div>
  );
}
