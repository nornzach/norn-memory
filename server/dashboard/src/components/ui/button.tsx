import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--focus)] disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // The main call to action on a page or dialog.
        default: "bg-action text-action-ink hover:bg-action-hover",
        primary: "bg-action text-action-ink hover:bg-action-hover",
        brand: "bg-brand text-white hover:bg-brand-hover dark:text-ink-inverse",
        // Secondary actions next to the main one.
        outline:
          "border border-line-strong bg-panel text-ink hover:border-ink-3/40 hover:bg-subtle",
        secondary:
          "border border-line bg-subtle text-ink hover:bg-subtle-hover",
        surfaceSecondary:
          "border border-line bg-subtle text-ink hover:bg-subtle-hover",
        surfacePrimary: "bg-panel text-ink hover:bg-subtle",
        tertiary: "bg-subtle text-ink hover:bg-subtle-hover",
        grey: "bg-subtle text-ink hover:bg-subtle-hover",
        // Quiet actions: toolbars, table rows, icon buttons.
        ghost: "text-ink-2 hover:bg-subtle hover:text-ink",
        subtle: "text-ink-2 hover:bg-subtle hover:text-ink",
        transparent: "text-ink-2 hover:bg-subtle hover:text-ink",
        destructive:
          "bg-danger text-white hover:bg-danger-hover dark:text-ink-inverse",
        "destructive-ghost": "text-danger hover:bg-danger-soft",
        link: "h-auto px-0 text-brand-text underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-3.5",
        sm: "h-8 px-3 text-[13px]",
        xs: "h-7 rounded-md px-2 text-xs",
        lg: "h-10 px-5",
        xl: "h-12 px-6 text-base",
        icon: "size-9",
        "icon-sm": "size-8",
        "icon-xs": "size-7 rounded-md",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
export type { ButtonProps };
