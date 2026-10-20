"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      position="bottom-right"
      style={{ zIndex: 10000 }}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-panel group-[.toaster]:text-ink group-[.toaster]:border-line group-[.toaster]:shadow-elev-3 group-[.toaster]:rounded-lg group-[.toaster]:pointer-events-auto",
          title: "group-[.toast]:text-sm group-[.toast]:font-semibold",
          description: "group-[.toast]:text-ink-3 group-[.toast]:text-sm",
          icon: "hidden",
          success:
            "group-[.toaster]:border-l-4 group-[.toaster]:border-l-[var(--success)]",
          error:
            "group-[.toaster]:border-l-4 group-[.toaster]:border-l-[var(--danger)]",
          actionButton:
            "group-[.toast]:bg-action group-[.toast]:text-action-ink",
          cancelButton: "group-[.toast]:bg-subtle group-[.toast]:text-ink-2",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
