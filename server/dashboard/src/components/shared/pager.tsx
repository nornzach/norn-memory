"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PanelFooter } from "@/components/shared/page";
import { useI18n } from "@/i18n/provider";

/** Previous/next paging under a table. Pass `total` when known, `hasMore` otherwise. */
export function Pager({
  page,
  pageSize,
  shown,
  total,
  hasMore,
  onPageChange,
  disabled,
}: {
  page: number;
  pageSize: number;
  /** Rows on the current page. */
  shown: number;
  total?: number;
  hasMore?: boolean;
  onPageChange: (page: number) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const from = shown === 0 ? 0 : page * pageSize + 1;
  const to = page * pageSize + shown;
  const canNext =
    total !== undefined ? (page + 1) * pageSize < total : Boolean(hasMore);

  if (page === 0 && !canNext) return null;

  return (
    <PanelFooter>
      <span className="tabular">
        {total !== undefined
          ? t.common.range(from, to, total)
          : `${from}–${to}`}
      </span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || page === 0}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft aria-hidden />
          {t.common.previous}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || !canNext}
          onClick={() => onPageChange(page + 1)}
        >
          {t.common.next}
          <ChevronRight aria-hidden />
        </Button>
      </div>
    </PanelFooter>
  );
}
