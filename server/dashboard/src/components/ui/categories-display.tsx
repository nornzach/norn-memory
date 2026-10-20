"use client";

import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface CategoriesDisplayProps {
  categories?: string[];
  /** Show every chip (detail views) instead of the first few plus "+N". */
  showAllCategories?: boolean;
  /** How many chips to show before collapsing into "+N". */
  max?: number;
  className?: string;
}

const TAG_COUNT = 8;

// The same category always gets the same color (FNV-1a, spreads short names well).
function hueFor(category: string) {
  let hash = 2166136261;
  for (let i = 0; i < category.length; i++) {
    hash ^= category.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `var(--tag-${((hash >>> 0) % TAG_COUNT) + 1})`;
}

/** Soft tinted pill; text is the hue nudged toward ink so it stays readable. */
export function CategoryChip({ category }: { category: string }) {
  const hue = hueFor(category);
  return (
    <span
      className="inline-flex h-6 max-w-[180px] items-center rounded-full px-2.5 text-xs font-medium"
      style={{
        backgroundColor: `color-mix(in srgb, ${hue} var(--tag-fill), transparent)`,
        color: `color-mix(in srgb, ${hue} 85%, var(--ink))`,
      }}
    >
      <span className="truncate">{category}</span>
    </span>
  );
}

export function CategoriesDisplay({
  categories,
  showAllCategories,
  max = 2,
  className,
}: CategoriesDisplayProps) {
  const all = categories ?? [];
  if (all.length === 0) return null;

  const shown = showAllCategories ? all : all.slice(0, max);
  const hidden = all.length - shown.length;

  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {shown.map((category) => (
        <CategoryChip key={category} category={category} />
      ))}
      {hidden > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              className="inline-flex h-6 items-center rounded-full bg-subtle px-2 text-xs font-medium text-ink-3 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--focus)]"
            >
              +{hidden}
            </span>
          </TooltipTrigger>
          <TooltipContent>{all.slice(shown.length).join(", ")}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
