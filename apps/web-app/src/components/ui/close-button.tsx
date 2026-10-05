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
        "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-fb-text-secondary transition-colors hover:bg-fb-surface-ghost hover:text-fb-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fb-season-solid disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      aria-label={label}
      {...props}
    >
      <X className="h-4 w-4" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </button>
  ),
);

CloseButton.displayName = "CloseButton";

export { CloseButton };
