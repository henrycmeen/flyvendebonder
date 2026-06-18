import * as React from "react";

import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-[color:color-mix(in_srgb,var(--fb-text-primary)_10%,var(--fb-surface-ghost))] motion-reduce:animate-none",
        className,
      )}
      aria-hidden="true"
      {...props}
    />
  );
}

export { Skeleton };
