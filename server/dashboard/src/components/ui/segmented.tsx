"use client";

import { KeyboardEvent, useRef } from "react";
import { cn } from "@/lib/utils";

interface SegmentedProps<V extends string> {
  value: V;
  onChange: (value: V) => void;
  options: { value: V; label: string }[];
  /** Accessible name for the group. */
  label: string;
  className?: string;
  size?: "sm" | "default";
}

/** A row of mutually exclusive choices (radio group) styled as a segmented switch. */
export function Segmented<V extends string>({
  value,
  onChange,
  options,
  label,
  className,
  size = "default",
}: SegmentedProps<V>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg bg-subtle p-0.5",
        size === "sm" ? "h-8" : "h-9",
        className,
      )}
    >
      {options.map((option, index) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={cn(
              "h-full flex-1 whitespace-nowrap rounded-md px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--focus)]",
              active
                ? "bg-panel text-ink shadow-elev-1"
                : "text-ink-3 hover:text-ink",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
