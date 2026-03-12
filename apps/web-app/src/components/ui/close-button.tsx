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
        "group inline-flex h-9 w-9 items-center justify-center rounded-full border border-[rgba(183,122,74,0.28)] bg-[linear-gradient(160deg,rgba(255,248,238,0.96),rgba(246,224,195,0.82))] text-[#6f1b18] shadow-[0_12px_28px_rgba(44,26,15,0.12),0_1px_0_rgba(255,251,244,0.82)_inset] transition-[transform,box-shadow,border-color] duration-[var(--fb-motion-duration-micro)] ease-[var(--fb-motion-easing-standard)] hover:-translate-y-[1px] hover:border-[rgba(166,82,76,0.38)] hover:shadow-[0_16px_30px_rgba(115,31,25,0.16),0_1px_0_rgba(255,251,244,0.9)_inset] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fb-season-solid focus-visible:ring-offset-2 focus-visible:ring-offset-fb-surface-base disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      aria-label={label}
      {...props}
    >
      <span
        aria-hidden="true"
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-[rgba(146,37,33,0.16)] bg-[linear-gradient(180deg,#ff7d73,#ed5d57)] text-[#651713] shadow-[0_1px_0_rgba(255,255,255,0.42)_inset,0_3px_8px_rgba(118,24,20,0.24)] transition-[transform,filter] duration-[var(--fb-motion-duration-micro)] ease-[var(--fb-motion-easing-standard)] group-hover:scale-[1.06] group-hover:brightness-[1.03]"
      >
        <X className="h-3.5 w-3.5" />
      </span>
      <span className="sr-only">{label}</span>
    </button>
  ),
);

CloseButton.displayName = "CloseButton";

export { CloseButton };
