"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  title: string;
  description?: string;
  /** An illustration, or pass `icon` for a smaller, quieter state. */
  image?: "memories" | "requests";
  icon?: LucideIcon;
  className?: string;
  children?: React.ReactNode;
}

export function EmptyState({
  title,
  description,
  image = "memories",
  icon: Icon,
  className,
  children,
}: EmptyStateProps) {
  const { resolvedTheme } = useTheme();
  // The theme is only known on the client; pick the art after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === "dark";

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-6 py-14 text-center",
        className,
      )}
    >
      {Icon ? (
        <span className="mb-4 grid size-11 place-items-center rounded-xl bg-subtle text-ink-3">
          <Icon className="size-5" aria-hidden />
        </span>
      ) : (
        <Image
          src={
            dark ? `/images/no-${image}-dark.svg` : `/images/no-${image}.svg`
          }
          alt=""
          width={112}
          height={112}
          className="mb-4"
        />
      )}
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-sm leading-5 text-ink-3">
          {description}
        </p>
      )}
      {children && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {children}
        </div>
      )}
    </div>
  );
}
