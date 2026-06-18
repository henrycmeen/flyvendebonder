import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const alertVariants = cva(
  "relative w-full rounded-lg border px-4 py-3 text-sm text-fb-text-primary shadow-soft transition-[border-color,background-color,box-shadow] duration-[var(--fb-motion-duration-small)] ease-[var(--fb-motion-easing-standard)] motion-reduce:transition-none",
  {
    variants: {
      variant: {
        default: "border-fb-border-subtle bg-fb-surface-ghost",
        success:
          "border-[color:color-mix(in_srgb,var(--fb-accent-emerald)_44%,transparent)] bg-[color:color-mix(in_srgb,var(--fb-accent-emerald)_10%,var(--fb-surface-page))]",
        warning:
          "border-[color:color-mix(in_srgb,var(--fb-season-solid)_46%,transparent)] bg-[color:color-mix(in_srgb,var(--fb-season-solid)_12%,var(--fb-surface-page))]",
        error:
          "border-[color:color-mix(in_srgb,var(--fb-accent-danger)_46%,transparent)] bg-[color:color-mix(in_srgb,var(--fb-accent-danger)_10%,var(--fb-surface-page))]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

interface AlertProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {}

function Alert({ className, variant, ...props }: AlertProps) {
  return <div className={cn(alertVariants({ variant, className }))} role="status" {...props} />;
}

function AlertTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("mb-1 font-semibold leading-none tracking-tight", className)} {...props} />;
}

function AlertDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm leading-relaxed text-fb-text-secondary", className)} {...props} />;
}

export { Alert, AlertDescription, AlertTitle };
