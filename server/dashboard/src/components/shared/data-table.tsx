"use client";

import { KeyboardEvent, ReactNode } from "react";
import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: keyof T;
  label: string;
  icon?: LucideIcon;
  render?(value: T[keyof T], row: T): ReactNode;
  /** Extra classes for the body cells of this column. */
  className?: string;
  /** Fixed width in px, or "auto". Numbers are real pixel widths, not weights. */
  width?: number | "auto";
  align?: "left" | "center" | "right";
  /** Hide this column below a breakpoint, so narrow screens keep the important ones. */
  hideBelow?: "sm" | "md" | "lg" | "xl";
  /** Cells that hold their own buttons: clicks there never open the row. */
  isAction?: boolean;
  /** Let long text wrap instead of staying on one line. */
  wrap?: boolean;
  cellVariant?: "default" | "flush";
  headerVariant?: "default" | "check";
}

interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  className?: string;
  getRowKey?: (row: T, rowIndex: number) => string | number;
  onRowClick?: (row: T, rowIndex: number) => void;
  getRowClassName?: (row: T, rowIndex: number) => string | undefined;
  /** Accessible name for a clickable row, e.g. "Open memory …". */
  getRowLabel?: (row: T) => string;
  /** On phones, render each row as a card instead of a sideways-scrolling table. */
  renderMobileCard?: (row: T, rowIndex: number) => ReactNode;
  caption?: string;
}

const HIDE_BELOW = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
} as const;

const ALIGN = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
} as const;

function activateOnKey(event: KeyboardEvent, action: () => void) {
  if (event.target !== event.currentTarget) return;
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    action();
  }
}

export function DataTable<T>({
  data,
  columns,
  className,
  getRowKey,
  onRowClick,
  getRowClassName,
  getRowLabel,
  renderMobileCard,
  caption,
}: DataTableProps<T>) {
  const keyOf = (row: T, i: number) =>
    getRowKey ? String(getRowKey(row, i)) : String(i);

  return (
    <div className={cn("min-w-0", className)}>
      {renderMobileCard && (
        <ul className="flex flex-col divide-y divide-line md:hidden">
          {data.map((row, i) => {
            const open = onRowClick ? () => onRowClick(row, i) : undefined;
            return (
              <li
                key={keyOf(row, i)}
                className={cn(
                  "px-5 py-3.5",
                  open &&
                    "cursor-pointer transition-colors hover:bg-subtle focus-visible:bg-subtle",
                  getRowClassName?.(row, i),
                )}
                role={open ? "button" : undefined}
                tabIndex={open ? 0 : undefined}
                aria-label={open ? getRowLabel?.(row) : undefined}
                onClick={open}
                onKeyDown={open ? (e) => activateOnKey(e, open) : undefined}
              >
                {renderMobileCard(row, i)}
              </li>
            );
          })}
        </ul>
      )}

      <div
        className={cn(
          "scrollbar-thin w-full overflow-x-auto",
          renderMobileCard && "hidden md:block",
        )}
      >
        <table className="w-full border-collapse text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr className="border-b border-line">
              {columns.map((column, index) => {
                const Icon = column.icon;
                return (
                  <th
                    key={index}
                    scope="col"
                    style={
                      typeof column.width === "number"
                        ? { width: column.width, minWidth: column.width }
                        : undefined
                    }
                    className={cn(
                      "h-11 whitespace-nowrap px-4 text-xs font-medium text-ink-3 first:pl-6 last:pr-6",
                      ALIGN[column.align ?? "left"],
                      column.hideBelow && HIDE_BELOW[column.hideBelow],
                    )}
                  >
                    {column.headerVariant === "check" ? (
                      <span className="sr-only">{column.label}</span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        {Icon && <Icon className="size-3.5" />}
                        {column.label}
                      </span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {data.map((row, rowIndex) => {
              const open = onRowClick
                ? () => onRowClick(row, rowIndex)
                : undefined;
              return (
                <tr
                  key={keyOf(row, rowIndex)}
                  className={cn(
                    "border-b border-line transition-colors last:border-b-0",
                    open
                      ? "cursor-pointer hover:bg-subtle focus-visible:bg-subtle focus-visible:outline-none"
                      : "hover:bg-subtle/50",
                    getRowClassName?.(row, rowIndex),
                  )}
                  tabIndex={open ? 0 : undefined}
                  aria-label={open ? getRowLabel?.(row) : undefined}
                  onClick={open}
                  onKeyDown={open ? (e) => activateOnKey(e, open) : undefined}
                >
                  {columns.map((column, colIndex) => {
                    const value = row[column.key];
                    return (
                      <td
                        key={colIndex}
                        className={cn(
                          "h-[52px] px-4 py-2.5 align-middle text-ink first:pl-6 last:pr-6",
                          column.wrap
                            ? "min-w-[180px] whitespace-normal"
                            : "whitespace-nowrap",
                          ALIGN[column.align ?? "left"],
                          column.hideBelow && HIDE_BELOW[column.hideBelow],
                          column.cellVariant === "flush" && "p-0",
                          column.className,
                        )}
                        onClick={
                          column.isAction
                            ? (e) => e.stopPropagation()
                            : undefined
                        }
                      >
                        {column.render
                          ? column.render(value, row)
                          : String(value ?? "")}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
