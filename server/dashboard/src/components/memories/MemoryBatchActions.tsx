/**
 * Memory Batch Actions
 * 
 * Bulk operations: mark as L0, adjust importance, delete multiple memories.
 */

'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ChevronDown, Star, Trash2, Tag } from 'lucide-react';

interface MemoryBatchActionsProps {
  selectedIds: string[];
  onMarkAsL0: (ids: string[]) => Promise<void>;
  onAdjustImportance: (ids: string[], importance: number) => Promise<void>;
  onDelete: (ids: string[]) => Promise<void>;
  onClearSelection: () => void;
}

export function MemoryBatchActions({
  selectedIds,
  onMarkAsL0,
  onAdjustImportance,
  onDelete,
  onClearSelection,
}: MemoryBatchActionsProps) {
  const [showImportanceDialog, setShowImportanceDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [importance, setImportance] = useState('7.0');
  const [isProcessing, setIsProcessing] = useState(false);

  const handleMarkAsL0 = async () => {
    setIsProcessing(true);
    try {
      await onMarkAsL0(selectedIds);
      onClearSelection();
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAdjustImportance = async () => {
    const value = parseFloat(importance);
    if (isNaN(value) || value < 1 || value > 10) {
      return;
    }

    setIsProcessing(true);
    try {
      await onAdjustImportance(selectedIds, value);
      setShowImportanceDialog(false);
      onClearSelection();
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDelete = async () => {
    setIsProcessing(true);
    try {
      await onDelete(selectedIds);
      setShowDeleteDialog(false);
      onClearSelection();
    } finally {
      setIsProcessing(false);
    }
  };

  if (selectedIds.length === 0) {
    return null;
  }

  return (
    <>
      <div className="flex items-center gap-3 p-4 bg-muted rounded-lg border">
        <Badge variant="secondary" className="text-sm">
          {selectedIds.length} selected
        </Badge>

        <div className="flex gap-2 flex-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={isProcessing}>
                Batch Actions
                <ChevronDown className="ml-2 h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={handleMarkAsL0}>
                <Tag className="mr-2 h-4 w-4" />
                Mark as L0 (Canonical)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowImportanceDialog(true)}>
                <Star className="mr-2 h-4 w-4" />
                Adjust Importance
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setShowDeleteDialog(true)}
                className="text-red-600"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Selected
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="ghost"
            size="sm"
            onClick={onClearSelection}
            disabled={isProcessing}
          >
            Clear Selection
          </Button>
        </div>
      </div>

      {/* Adjust Importance Dialog */}
      <Dialog open={showImportanceDialog} onOpenChange={setShowImportanceDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adjust Importance</DialogTitle>
            <DialogDescription>
              Set new importance score for {selectedIds.length} selected memor{selectedIds.length === 1 ? 'y' : 'ies'}.
              Valid range: 1.0 - 10.0
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="importance">Importance Score</Label>
            <Input
              id="importance"
              type="number"
              min="1"
              max="10"
              step="0.5"
              value={importance}
              onChange={(e) => setImportance(e.target.value)}
              className="mt-2"
            />
            <div className="mt-2 text-sm text-muted-foreground">
              <ul className="list-disc list-inside space-y-1">
                <li>8-10: Core principles, critical facts</li>
                <li>5-7: Useful information, preferences</li>
                <li>3-4: Temporary details</li>
                <li>1-2: Noise, will be archived</li>
              </ul>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowImportanceDialog(false)}
              disabled={isProcessing}
            >
              Cancel
            </Button>
            <Button onClick={handleAdjustImportance} disabled={isProcessing}>
              {isProcessing ? 'Processing...' : 'Apply'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Memories</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete {selectedIds.length} selected memor{selectedIds.length === 1 ? 'y' : 'ies'}?
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
              disabled={isProcessing}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isProcessing}
            >
              {isProcessing ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
