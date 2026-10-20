import { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { fieldLabelClassName } from "@/constants/ui-components";
import { cn } from "@/lib/utils";

/** Label, control, then a hint or an error underneath. */
export function Field({
  id,
  label,
  hint,
  error,
  optional,
  className,
  children,
}: {
  id?: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Text shown after the label, e.g. "Optional". */
  optional?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label htmlFor={id} className={fieldLabelClassName}>
        {label}
        {optional && (
          <span className="ml-1.5 font-normal text-ink-3">{optional}</span>
        )}
      </Label>
      {children}
      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs leading-5 text-ink-3">{hint}</p>
      )}
    </div>
  );
}
