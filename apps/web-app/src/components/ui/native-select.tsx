import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const NativeSelect = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => <select ref={ref} className={cn("min-h-10 max-w-full rounded-lg border border-fb-border-subtle bg-fb-surface-base px-3 text-sm text-fb-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fb-focus disabled:cursor-not-allowed disabled:opacity-50", className)} {...props} />,
);
NativeSelect.displayName = "NativeSelect";
