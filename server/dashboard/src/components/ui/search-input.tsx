"use client";

import * as React from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { inputVariants } from "@/constants/ui-components";
import { useI18n } from "@/i18n/provider";

interface SearchInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "onChange" | "value"
> {
  value: string;
  onValueChange: (value: string) => void;
  containerClassName?: string;
}

/** Text input with a search icon and a clear button. */
export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  ({ value, onValueChange, className, containerClassName, ...props }, ref) => {
    const { t } = useI18n();
    return (
      <div className={cn("relative min-w-0", containerClassName)}>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3"
          aria-hidden
        />
        <input
          ref={ref}
          type="search"
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          className={cn(
            inputVariants.default,
            "pl-9 pr-8 [&::-webkit-search-cancel-button]:hidden",
            className,
          )}
          {...props}
        />
        {value && (
          <button
            type="button"
            onClick={() => onValueChange("")}
            aria-label={t.common.clearFilters}
            className="absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-ink-3 hover:bg-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--focus)]"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        )}
      </div>
    );
  },
);
SearchInput.displayName = "SearchInput";
