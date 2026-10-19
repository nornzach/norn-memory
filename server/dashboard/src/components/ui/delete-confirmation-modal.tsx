import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n/provider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

interface DeleteConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  itemName: string;
  confirmButtonText?: string;
}

const DeleteConfirmationModal = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  itemName,
  confirmButtonText,
}: DeleteConfirmationModalProps) => {
  const { t } = useI18n();
  const [confirmationText, setConfirmationText] = useState("");

  const handleClose = () => {
    setConfirmationText("");
    onClose();
  };

  const handleConfirm = () => {
    onConfirm();
    setConfirmationText("");
  };

  const isDeleteEnabled = confirmationText === itemName;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription className="mb-4">{description}</DialogDescription>

        <div className="space-y-4">
          <p className="text-sm text-[#565553]">
            {t.deleteModal.typeBefore}{" "}
            <span className="font-bold">{itemName}</span>{" "}
            {t.deleteModal.typeAfter}
          </p>
          <Input
            type="text"
            placeholder={t.deleteModal.placeholder}
            value={confirmationText}
            onChange={(e) => setConfirmationText(e.target.value)}
            className="w-full"
          />
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <Button onClick={handleClose} variant="outline">
            {t.common.cancel}
          </Button>
          <Button
            onClick={handleConfirm}
            variant="destructive"
            disabled={!isDeleteEnabled}
          >
            {confirmButtonText ?? t.common.delete}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default DeleteConfirmationModal;
