import * as React from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

interface CloseButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label?: string;
}

const CloseButton = React.forwardRef<HTMLButtonElement, CloseButtonProps>(
  ({ className, label = "Lukk", type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        "group inline-flex h-9 w-9 items-center justify-center rounded-full border border-fb-border-subtle bg-fb-surface-ghost text-[color:var(--fb-accent-danger)] shadow-fb-subtle transition-[transform,background-color,border-color,box-shadow] duration-[var(--fb-motion-duration-micro)] ease-[var(--fb-motion-easing-standard)] motion-reduce:transition-none motion-reduce:hover:translate-y-0 hover:-translate-y-[1px] hover:border-fb-border-strong hover:bg-[color:color-mix(in_srgb,var(--fb-accent-danger)_8%,var(--fb-surface-page))] hover:shadow-fb-floating focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fb-season-solid focus-visible:ring-offset-2 focus-visible:ring-offset-fb-surface-base disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      aria-label={label}
      {...props}
    >
      <span
        aria-hidden="true"
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-[color:color-mix(in_srgb,var(--fb-accent-danger)_24%,transparent)] bg-[color:color-mix(in_srgb,var(--fb-accent-danger)_12%,var(--fb-surface-page))] text-[color:var(--fb-accent-danger)] shadow-fb-subtle transition-[transform,background-color,color] duration-[var(--fb-motion-duration-micro)] ease-[var(--fb-motion-easing-standard)] motion-reduce:transition-none motion-reduce:group-hover:scale-100 group-hover:scale-[1.06] group-hover:bg-[color:color-mix(in_srgb,var(--fb-accent-danger)_18%,var(--fb-surface-page))]"
      >
        <X className="h-3.5 w-3.5" />
      </span>
      <span className="sr-only">{label}</span>
    </button>
  ),
);

CloseButton.displayName = "CloseButton";

export { CloseButton };
