import { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Title row of a dashboard page. Actions wrap under the title on narrow screens. */
export function PageHeader({
  title,
  meta,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  /** A short note beside the title, such as a count. */
  meta?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "mb-7 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="font-serif text-[28px] font-normal leading-tight tracking-[-0.01em] text-ink sm:text-[34px]">
            {title}
          </h1>
          {meta && <span className="tabular text-sm text-ink-3">{meta}</span>}
        </div>
        {description && (
          <p className="mt-2 max-w-2xl text-[15px] leading-6 text-ink-3">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </header>
  );
}

/** The white card most page content sits in. */
export function Panel({
  className,
  children,
  as: Comp = "section",
  ...props
}: React.HTMLAttributes<HTMLElement> & { as?: "section" | "div" }) {
  return (
    <Comp
      className={cn(
        "min-w-0 overflow-hidden rounded-2xl border border-line bg-panel shadow-elev-1",
        className,
      )}
      {...props}
    >
      {children}
    </Comp>
  );
}

export function PanelHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 border-b border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-5",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="font-serif text-[19px] font-normal leading-7 text-ink">
          {title}
        </h2>
        {description && (
          <p className="mt-0.5 text-sm leading-6 text-ink-3">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </div>
  );
}

export function PanelBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5 sm:p-6", className)} {...props} />;
}

export function PanelFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 border-t border-line bg-sunken/60 px-5 py-3.5 text-sm text-ink-3 sm:flex-row sm:items-center sm:justify-between sm:px-6",
        className,
      )}
      {...props}
    />
  );
}

/** Filters above a table: one row on wide screens, a grid that wraps on small ones. */
export function FilterBar({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-2 border-b border-line px-5 py-3.5 xs:grid-cols-2 sm:px-6 md:flex md:flex-wrap md:items-center",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "neutral",
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  tone?: "neutral" | "brand" | "success" | "warning" | "danger";
}) {
  const toneClass = {
    neutral: "bg-subtle text-ink-3",
    brand: "bg-brand-soft text-brand-text",
    success: "bg-success-soft text-success",
    warning: "bg-warning-soft text-warning",
    danger: "bg-danger-soft text-danger",
  }[tone];
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-panel p-4 shadow-elev-1 sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-2 text-xs font-medium text-ink-3 sm:text-[13px]">
          {label}
        </p>
        {Icon && (
          <span
            className={cn(
              "hidden size-7 shrink-0 place-items-center rounded-lg sm:grid",
              toneClass,
            )}
          >
            <Icon className="size-4" aria-hidden />
          </span>
        )}
      </div>
      <p className="tabular mt-2 truncate font-serif text-2xl font-normal tracking-tight text-ink sm:mt-3 sm:text-[32px] sm:leading-none">
        {value}
      </p>
      {hint && (
        <p className="mt-1 hidden truncate text-xs text-ink-3 sm:block">
          {hint}
        </p>
      )}
    </div>
  );
}

/** Label/value pairs, used in detail sheets. */
export function DetailList({
  items,
  className,
}: {
  items: { label: ReactNode; value: ReactNode; wide?: boolean }[];
  className?: string;
}) {
  return (
    <dl
      className={cn(
        "grid grid-cols-1 gap-x-6 gap-y-4 xs:grid-cols-2",
        className,
      )}
    >
      {items.map((item, i) => (
        <div key={i} className={cn("min-w-0", item.wide && "xs:col-span-2")}>
          <dt className="text-xs font-medium text-ink-3">{item.label}</dt>
          <dd className="mt-1 break-words text-sm text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Small mono pill for ids. */
export function IdText({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-block max-w-full truncate rounded-md bg-subtle px-1.5 py-0.5 align-middle font-mono text-xs text-ink-2",
        className,
      )}
    >
      {children}
    </span>
  );
}
