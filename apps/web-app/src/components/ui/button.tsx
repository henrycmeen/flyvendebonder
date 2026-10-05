import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
    "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-[13px] font-medium transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-[var(--fb-motion-duration-micro)] ease-[var(--fb-motion-easing-standard)] motion-reduce:transition-none enabled:active:scale-[0.98] enabled:active:ease-[var(--fb-motion-easing-accelerate)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-fb-surface-base disabled:pointer-events-none disabled:opacity-50 data-[loading=true]:cursor-wait data-[state=loading]:cursor-wait data-[state=success]:!bg-[color:var(--fb-accent-emerald)] data-[state=success]:!text-fb-surface-base data-[state=error]:!bg-[color:var(--fb-accent-danger)] data-[state=error]:!text-fb-surface-base data-[state=error]:!focus-visible:ring-[color:var(--fb-accent-danger)]",
  {
    variants: {
      variant: {
        default: "bg-fb-text-primary text-white hover:opacity-90 focus-visible:ring-fb-season-solid",
        outline:
          "border border-fb-border-subtle bg-fb-surface-base text-fb-text-primary hover:bg-fb-surface-ghost focus-visible:ring-fb-season-solid",
        ghost: "text-fb-text-secondary hover:bg-fb-surface-ghost focus-visible:ring-fb-season-solid",
        secondary: "border border-fb-border-subtle bg-fb-surface-ghost text-fb-text-primary hover:bg-fb-surface-base focus-visible:ring-fb-focus",
        destructive: "bg-[color:var(--fb-accent-danger)] text-white hover:brightness-95 focus-visible:ring-fb-focus",
      },
      size: {
        default: "h-9 px-3.5 py-2",
        sm: "h-8 rounded-lg px-3 text-xs",
        lg: "h-11 rounded-lg px-5",
        icon: "h-11 w-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
  loadingLabel?: string;
  feedbackState?: "success" | "error";
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading = false, loadingLabel = "Laster", feedbackState, disabled, children, ...props }, ref) => {
    const isDisabled = disabled || loading;
    const computedState = loading ? "loading" : feedbackState;

    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={isDisabled}
        data-state={computedState}
        data-loading={loading ? "true" : undefined}
        data-fb-button=""
        aria-busy={loading || undefined}
        {...props}
      >
        <span className={cn("inline-flex items-center gap-2", loading && "opacity-0")}>{children}</span>
        {loading ? <Loader2 className="pointer-events-none absolute h-4 w-4 animate-spin motion-reduce:animate-none" /> : null}
        {loading ? <span className="sr-only">{loadingLabel}</span> : null}
      </button>
    );
  },
);
Button.displayName = "Button";

export { Button };
