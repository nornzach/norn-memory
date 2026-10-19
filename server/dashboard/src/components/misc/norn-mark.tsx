import { cn } from "@/lib/utils";

/** The Norn-M mark: an N drawn as three threads, the middle one in the accent color.
 * Fixed colors so it reads the same on light and dark surfaces, and matches the favicon. */
export function NornMark({
  size = 28,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-hidden="true"
    >
      <rect
        x="0.5"
        y="0.5"
        width="31"
        height="31"
        rx="8"
        fill="#0F172A"
        stroke="#FFFFFF"
        strokeOpacity="0.14"
      />
      <g strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 23V9" stroke="#F8FAFC" />
        <path d="M10 9L22 23" stroke="#2DD4BF" />
        <path d="M10 23V9" stroke="#F8FAFC" />
      </g>
    </svg>
  );
}

/** The mark followed by the product name. */
export function NornWordmark({
  size = 28,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <NornMark size={size} />
      <span
        className="font-fustat font-semibold tracking-tight text-onSurface-default-primary"
        style={{ fontSize: Math.round(size * 0.72) }}
      >
        Norn-M
      </span>
    </span>
  );
}
