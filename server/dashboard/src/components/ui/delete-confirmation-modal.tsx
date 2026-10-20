import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n/provider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface DeleteConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  description: string;
  itemName: string;
  confirmButtonText?: string;
  /** Ask the user to type `itemName` first. Use for deletes that remove many things at once. */
  requireTyping?: boolean;
}

const DeleteConfirmationModal = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  itemName,
  confirmButtonText,
  requireTyping = false,
}: DeleteConfirmationModalProps) => {
  const { t } = useI18n();
  const [confirmationText, setConfirmationText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isOpen) setConfirmationText("");
  }, [isOpen]);

  const canDelete = !busy && (!requireTyping || confirmationText === itemName);

  const handleConfirm = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!canDelete) return;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <form onSubmit={handleConfirm} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          {requireTyping && (
            <div className="space-y-2">
              <p className="text-sm text-ink-2">
                {t.deleteModal.typeBefore}{" "}
                <span className="break-all rounded bg-subtle px-1 py-0.5 font-mono text-[13px] font-medium text-ink">
                  {itemName}
                </span>{" "}
                {t.deleteModal.typeAfter}
              </p>
              <Input
                type="text"
                autoFocus
                autoComplete="off"
                placeholder={t.deleteModal.placeholder}
                value={confirmationText}
                onChange={(e) => setConfirmationText(e.target.value)}
              />
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              onClick={onClose}
              variant="outline"
              disabled={busy}
            >
              {t.common.cancel}
            </Button>
            <Button type="submit" variant="destructive" disabled={!canDelete}>
              {busy && <Loader2 className="animate-spin" aria-hidden />}
              {confirmButtonText ?? t.common.delete}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default DeleteConfirmationModal;
