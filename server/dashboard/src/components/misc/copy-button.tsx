"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { CopyToClipboard } from "react-copy-to-clipboard";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/provider";

interface CopyButtonProps {
  text: string;
  /** Accessible name, e.g. "Copy API key". Defaults to "Copy". */
  label?: string;
  /** Show the word next to the icon instead of an icon-only button. */
  showLabel?: boolean;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
}

/** Copies `text` and confirms with a check mark for a moment. */
export function CopyButton({
  text,
  label,
  showLabel = false,
  variant = "ghost",
  size,
  className,
}: CopyButtonProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const name = copied ? t.common.copied : (label ?? t.common.copy);
  // The visible word stays short; the specific label is for screen readers.
  const word = copied ? t.common.copied : t.common.copy;
  const Icon = copied ? Check : Copy;

  return (
    <CopyToClipboard
      text={text}
      onCopy={() => {
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1500);
      }}
    >
      <Button
        type="button"
        variant={variant}
        size={size ?? (showLabel ? "sm" : "icon-sm")}
        aria-label={showLabel && !label ? undefined : name}
        title={showLabel ? undefined : name}
        className={cn(copied && "text-success", className)}
      >
        <Icon aria-hidden />
        {showLabel && <span aria-live="polite">{word}</span>}
      </Button>
    </CopyToClipboard>
  );
}

export default CopyButton;
