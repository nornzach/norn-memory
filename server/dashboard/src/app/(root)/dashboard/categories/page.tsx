"use client";

import { useState } from "react";
import { Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { format } from "date-fns";
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
import { DataTable } from "@/components/shared/data-table";
import { TableSkeleton } from "@/components/shared/table-skeleton";
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
  const [isSaving, setIsSaving] = useState(false);
  const [isTagging, setIsTagging] = useState(false);
  const [categoryToDelete, setCategoryToDelete] = useState<Category | null>(
    null,
  );
  const { t, dateLocale } = useI18n();

  const {
    data: categories = [],
    isLoading,
    refetch,
  } = useApiQuery<Category[]>(
    async () => {
      const res = await api.get<Category[]>(CATEGORY_ENDPOINTS.BASE);
      return res.data ?? [];
    },
    { errorToast: t.categories.loadFailed, initialData: [] },
  );

  const openEditor = (state: EditorState) => {
    setEditor(state);
    setName(state.mode === "edit" ? state.category.name : "");
    setDescription(state.mode === "edit" ? state.category.description : "");
  };

  const handleSave = async () => {
    if (!editor) return;
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
    } catch (error) {
      toast({
        title: t.categories.saveFailed,
        description: getErrorMessage(error),
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
    } catch (error) {
      toast({
        title: t.categories.deleteFailed,
        description: getErrorMessage(error),
        variant: "destructive",
      });
    }
  };

  const handleBackfill = async () => {
    setIsTagging(true);
    try {
      const res = await api.post<CategoryBackfillResponse>(
        CATEGORY_ENDPOINTS.BACKFILL,
      );
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
    } catch (error) {
      toast({
        title: t.categories.taggingFailed,
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setIsTagging(false);
    }
  };

  const columns = [
    {
      key: "name" as keyof Category,
      label: t.categories.columns.name,
      width: 150,
    },
    {
      key: "description" as keyof Category,
      label: t.categories.columns.description,
      width: 280,
      render: (value: string) => (
        <span className="line-clamp-2 text-sm text-onSurface-default-secondary">
          {value || "--"}
        </span>
      ),
    },
    {
      key: "memory_count" as keyof Category,
      label: t.categories.columns.memories,
      width: 80,
    },
    {
      key: "created_at" as keyof Category,
      label: t.categories.columns.created,
      width: 100,
      render: (value: string) =>
        format(new Date(value), t.common.dateFormat, { locale: dateLocale }),
    },
    {
      key: "id" as keyof Category,
      label: "",
      width: 70,
      render: (_: string, row: Category) => (
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={t.categories.editLabel(row.name)}
            onClick={() => openEditor({ mode: "edit", category: row })}
          >
            <Pencil className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={t.categories.deleteLabel(row.name)}
            onClick={() => setCategoryToDelete(row)}
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
            {t.categories.title}
          </h1>
          <p className="text-sm text-onSurface-default-secondary mt-1">
            {t.categories.subtitle}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleBackfill}
            disabled={isTagging || categories.length === 0}
          >
            <Sparkles className="size-4 mr-1" /> {t.categories.tagExisting}
          </Button>
          <Button size="sm" onClick={() => openEditor({ mode: "create" })}>
            <Plus className="size-4 mr-1" /> {t.categories.add}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <TableSkeleton rows={3} columns={4} />
      ) : categories.length === 0 ? (
        <EmptyState
          title={t.categories.emptyTitle}
          description={t.categories.emptyDescription}
        />
      ) : (
        <Card className="border-memBorder-primary overflow-hidden">
          <DataTable
            data={categories}
            columns={columns}
            getRowKey={(row) => row.id}
          />
        </Card>
      )}

      <Dialog
        open={!!editor}
        onOpenChange={(open) => {
          if (!open) setEditor(null);
        }}
      >
        <DialogContent>
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
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label htmlFor="category-name">{t.common.name}</Label>
              <Input
                id="category-name"
                value={name}
                maxLength={64}
                onChange={(e) => setName(e.target.value)}
                placeholder={t.categories.namePlaceholder}
              />
            </div>
            <Textarea
              id="category-description"
              label={t.common.description}
              value={description}
              maxLength={2000}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t.categories.descriptionPlaceholder}
            />
            <Button
              onClick={handleSave}
              disabled={!name.trim() || isSaving}
              className="w-full"
            >
              {editor?.mode === "edit" ? t.common.save : t.common.create}
            </Button>
          </div>
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
    </div>
  );
}
