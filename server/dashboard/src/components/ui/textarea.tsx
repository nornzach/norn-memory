import * as React from "react";

import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { fieldLabelClassName } from "@/constants/ui-components";
import { TextareaProps } from "@/types/ui-components";

/** Multi-line field styled like Input; grows by rows, resizable vertically. */
const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      label,
      containerClassName,
      textareaClassName,
      labelClassName,
      id: idProp,
      className,
      ...props
    },
    ref,
  ) => {
    const generatedId = React.useId();
    const id = idProp ?? generatedId;

    const textarea = (
      <textarea
        id={id}
        className={cn(
          "flex min-h-[112px] w-full min-w-0 resize-y rounded-lg border border-line-strong bg-panel px-3 py-2.5 text-sm leading-6 text-ink shadow-elev-1 transition-[border-color,box-shadow] placeholder:text-ink-3 focus-visible:border-brand focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--focus)] disabled:cursor-not-allowed disabled:opacity-50",
          textareaClassName,
          className,
        )}
        ref={ref}
        {...props}
      />
    );

    if (label) {
      return (
        <div className={cn("flex flex-col gap-1.5", containerClassName)}>
          <Label
            htmlFor={id}
            className={cn(fieldLabelClassName, labelClassName)}
          >
            {label}
          </Label>
          {textarea}
        </div>
      );
    }

    return textarea;
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
