"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  Loader2,
  Pencil,
  Plus,
  RefreshCcw,
  Sparkles,
  Tags,
  Trash2,
} from "lucide-react";
import { format } from "date-fns";
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
import { CategoryChip } from "@/components/ui/categories-display";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Column, DataTable } from "@/components/shared/data-table";
import { TableSkeleton } from "@/components/shared/table-skeleton";
import { ErrorBanner } from "@/components/shared/error-banner";
import { Field } from "@/components/shared/field";
import { PageHeader, Panel } from "@/components/shared/page";
import { EmptyState } from "@/components/self-hosted/empty-state";
import DeleteConfirmationModal from "@/components/ui/delete-confirmation-modal";
import { toast } from "@/components/ui/use-toast";
import { getErrorMessage } from "@/lib/error-message";
import { api } from "@/utils/api";
import { CATEGORY_ENDPOINTS } from "@/utils/api-endpoints";
import { useApiQuery } from "@/hooks/use-api-query";
import { Category, CategoryBackfillResponse } from "@/types/api";
import { useI18n } from "@/i18n/provider";

type EditorState = { mode: "create" } | { mode: "edit"; category: Category };

export default function CategoriesPage() {
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [nameError, setNameError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isTagging, setIsTagging] = useState(false);
  const [confirmRetag, setConfirmRetag] = useState(false);
  const [categoryToDelete, setCategoryToDelete] = useState<Category | null>(
    null,
  );
  const { t, dateLocale } = useI18n();

  const {
    data: categories = [],
    isLoading,
    error,
    refetch,
  } = useApiQuery<Category[]>(
    async () => (await api.get<Category[]>(CATEGORY_ENDPOINTS.BASE)).data ?? [],
    { errorToast: t.categories.loadFailed, initialData: [] },
  );

  const openEditor = (state: EditorState) => {
    setEditor(state);
    setName(state.mode === "edit" ? state.category.name : "");
    setDescription(state.mode === "edit" ? state.category.description : "");
    setNameError("");
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!editor) return;
    if (!name.trim()) {
      setNameError(t.categories.nameRequired);
      return;
    }
    setIsSaving(true);
    try {
      const body = { name: name.trim(), description: description.trim() };
      if (editor.mode === "create") {
        await api.post(CATEGORY_ENDPOINTS.BASE, body);
        toast({ title: t.categories.created, variant: "success" });
      } else {
        await api.patch(CATEGORY_ENDPOINTS.BY_ID(editor.category.id), body);
        toast({ title: t.categories.updated, variant: "success" });
      }
      setEditor(null);
      void refetch();
    } catch (err) {
      toast({
        title: t.categories.saveFailed,
        description: getErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!categoryToDelete) return;
    try {
      await api.delete(CATEGORY_ENDPOINTS.BY_ID(categoryToDelete.id));
      toast({ title: t.categories.deleted, variant: "success" });
      setCategoryToDelete(null);
      void refetch();
    } catch (err) {
      toast({
        title: t.categories.deleteFailed,
        description: getErrorMessage(err),
        variant: "destructive",
      });
    }
  };

  const handleBackfill = async (retagAll = false) => {
    setIsTagging(true);
    try {
      const res = await api.post<CategoryBackfillResponse>(
        CATEGORY_ENDPOINTS.BACKFILL,
        undefined,
        retagAll ? { params: { retag_all: true } } : undefined,
      );
      setConfirmRetag(false);
      toast({
        title: res.data.queued
          ? t.categories.taggingStarted
          : t.categories.nothingToTag,
        description:
          res.data.queued > 0
            ? t.categories.taggingQueued(res.data.queued)
            : t.categories.allTagged,
        variant: "success",
      });
    } catch (err) {
      toast({
        title: t.categories.taggingFailed,
        description: getErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setIsTagging(false);
    }
  };

  const memoriesLink = (row: Category) => (
    <Link
      href={`/dashboard/memories?category=${encodeURIComponent(row.name)}`}
      aria-label={t.categories.viewMemoriesLabel(row.name)}
      className="tabular rounded font-medium text-brand-text underline decoration-brand/30 underline-offset-4 hover:decoration-brand focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--focus)]"
    >
      {row.memory_count}
    </Link>
  );

  const rowActions = (row: Category) => (
    <div className="flex items-center justify-end gap-1">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t.categories.editLabel(row.name)}
        title={t.categories.editLabel(row.name)}
        onClick={() => openEditor({ mode: "edit", category: row })}
      >
        <Pencil aria-hidden />
      </Button>
      <Button
        variant="destructive-ghost"
        size="icon-sm"
        aria-label={t.categories.deleteLabel(row.name)}
        title={t.categories.deleteLabel(row.name)}
        onClick={() => setCategoryToDelete(row)}
      >
        <Trash2 aria-hidden />
      </Button>
    </div>
  );

  const columns: Column<Category>[] = [
    {
      key: "name",
      label: t.categories.columns.name,
      render: (value) => <CategoryChip category={String(value)} />,
    },
    {
      key: "description",
      label: t.categories.columns.description,
      wrap: true,
      render: (value) => (
        <span className="line-clamp-2 max-w-xl text-sm text-ink-2">
          {String(value || t.common.none)}
        </span>
      ),
    },
    {
      key: "memory_count",
      label: t.categories.columns.memories,
      align: "right",
      render: (_, row) => memoriesLink(row),
    },
    {
      key: "created_at",
      label: t.categories.columns.created,
      hideBelow: "lg",
      className: "text-ink-2",
      render: (value) =>
        format(new Date(String(value)), t.common.dateFormat, {
          locale: dateLocale,
        }),
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
        title={t.categories.title}
        description={t.categories.subtitle}
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  disabled={isTagging || categories.length === 0}
                >
                  {isTagging ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <Sparkles aria-hidden />
                  )}
                  {t.categories.tagMenu}
                  <ChevronDown className="text-ink-3" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuItem
                  className="items-start gap-2.5 py-2"
                  onSelect={() => void handleBackfill()}
                >
                  <Sparkles className="mt-0.5" />
                  <span className="flex min-w-0 flex-col">
                    <span>{t.categories.tagUntagged}</span>
                    <span className="text-xs text-ink-3">
                      {t.categories.tagUntaggedHint}
                    </span>
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="items-start gap-2.5 py-2"
                  onSelect={() => setConfirmRetag(true)}
                >
                  <RefreshCcw className="mt-0.5" />
                  <span className="flex min-w-0 flex-col">
                    <span>{t.categories.retagAll}</span>
                    <span className="text-xs text-ink-3">
                      {t.categories.retagAllHint}
                    </span>
                  </span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button onClick={() => openEditor({ mode: "create" })}>
              <Plus aria-hidden />
              {t.categories.add}
            </Button>
          </>
        }
      />

      {error && !isLoading && (
        <ErrorBanner message={error} onRetry={() => void refetch()} />
      )}

      <Panel>
        {isLoading ? (
          <TableSkeleton rows={4} columns={4} />
        ) : categories.length === 0 ? (
          <EmptyState
            icon={Tags}
            title={t.categories.emptyTitle}
            description={t.categories.emptyDescription}
          >
            <Button onClick={() => openEditor({ mode: "create" })}>
              <Plus aria-hidden />
              {t.categories.add}
            </Button>
          </EmptyState>
        ) : (
          <DataTable
            data={categories}
            columns={columns}
            caption={t.categories.title}
            getRowKey={(row) => row.id}
            renderMobileCard={(row) => (
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <CategoryChip category={row.name} />
                    <span className="text-xs text-ink-3">
                      {memoriesLink(row)} {t.categories.columns.memories}
                    </span>
                  </div>
                  {row.description && (
                    <p className="line-clamp-2 text-sm text-ink-2">
                      {row.description}
                    </p>
                  )}
                </div>
                {rowActions(row)}
              </div>
            )}
          />
        )}
      </Panel>

      <Dialog
        open={!!editor}
        onOpenChange={(open) => !open && !isSaving && setEditor(null)}
      >
        <DialogContent>
          <form onSubmit={handleSave} className="grid gap-5" noValidate>
            <DialogHeader>
              <DialogTitle>
                {editor?.mode === "edit"
                  ? t.categories.editTitle
                  : t.categories.addTitle}
              </DialogTitle>
              <DialogDescription>
                {editor?.mode === "edit"
                  ? t.categories.editDescription
                  : t.categories.addDescription}
              </DialogDescription>
            </DialogHeader>
            <Field id="category-name" label={t.common.name} error={nameError}>
              <Input
                id="category-name"
                value={name}
                maxLength={64}
                autoFocus
                onChange={(e) => {
                  setName(e.target.value);
                  setNameError("");
                }}
                placeholder={t.categories.namePlaceholder}
                aria-invalid={Boolean(nameError)}
              />
            </Field>
            <Field
              id="category-description"
              label={t.common.description}
              hint={t.categories.howItWorks}
            >
              <Textarea
                id="category-description"
                value={description}
                maxLength={2000}
                rows={3}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t.categories.descriptionPlaceholder}
              />
            </Field>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditor(null)}
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
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmRetag}
        onOpenChange={(open) => !isTagging && setConfirmRetag(open)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t.categories.retagTitle}</DialogTitle>
            <DialogDescription>
              {t.categories.retagDescription}
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-ink-3">{t.categories.retagRuns}</p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmRetag(false)}
              disabled={isTagging}
            >
              {t.common.cancel}
            </Button>
            <Button
              onClick={() => void handleBackfill(true)}
              disabled={isTagging}
            >
              {isTagging ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <RefreshCcw aria-hidden />
              )}
              {t.categories.retagConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteConfirmationModal
        isOpen={!!categoryToDelete}
        onClose={() => setCategoryToDelete(null)}
        onConfirm={handleDelete}
        title={t.categories.deleteTitle}
        description={t.categories.deleteDescription}
        itemName={categoryToDelete?.name ?? ""}
      />
    </>
  );
}
