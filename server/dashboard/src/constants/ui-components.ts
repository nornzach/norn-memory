export const fieldLabelClassName =
  "text-[13px] font-medium leading-5 text-ink-2";

const fieldBase =
  "rounded-lg border border-line-strong bg-panel text-sm text-ink transition-[border-color,box-shadow] placeholder:text-ink-3 hover:border-ink-3/60 focus-visible:outline-none focus-visible:border-brand focus-visible:ring-[3px] focus-visible:ring-[var(--focus)] disabled:cursor-not-allowed disabled:opacity-50";

export const inputVariants = {
  default: `flex h-9 w-full min-w-0 px-3 file:border-0 file:bg-transparent file:text-sm file:font-medium ${fieldBase}`,
  textField: `peer flex h-9 w-full min-w-0 px-3 file:border-0 file:bg-transparent file:text-sm file:font-medium ${fieldBase}`,
  nestedInput:
    "peer flex h-9 w-full min-w-0 border-0 bg-transparent px-0 text-sm text-ink placeholder:text-ink-3 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
} as const;

const triggerBase =
  "relative flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-line-strong bg-panel pl-3 pr-9 text-left text-sm text-ink transition-[border-color,box-shadow] hover:border-ink-3/60 focus:outline-none focus-visible:border-brand focus-visible:ring-[3px] focus-visible:ring-[var(--focus)] data-[placeholder]:text-ink-3 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:truncate";

export const selectTriggerVariants = {
  default: triggerBase,
  dropdown: triggerBase,
} as const;
