import { cn } from "@/lib/utils";

export function Spinner({
  size = "small",
  className,
}: {
  size?: "small" | "large";
  className?: string;
}) {
  return (
    <span
      role="status"
      className={cn(
        "inline-block animate-spin rounded-full border-2 border-line-strong border-t-brand",
        size === "small" ? "size-4" : "size-6",
        className,
      )}
    />
  );
}
