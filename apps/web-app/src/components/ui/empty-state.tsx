import * as React from "react";

import { cn } from "@/lib/utils";

interface EmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}

function EmptyState({ className, icon, title, description, actions, children, ...props }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex min-h-[180px] flex-col items-center justify-center rounded-xl border border-dashed border-fb-border-subtle bg-fb-surface-ghost px-5 py-8 text-center text-fb-text-primary",
        className,
      )}
      {...props}
    >
      {icon ? (
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[color:color-mix(in_srgb,var(--fb-season-solid)_14%,var(--fb-surface-page))] text-[color:var(--fb-season-solid)]">
          {icon}
        </div>
      ) : null}
      <h3 className="text-sm font-semibold">{title}</h3>
      {description ? <p className="mt-1 max-w-md text-sm leading-relaxed text-fb-text-secondary">{description}</p> : null}
      {children ? <div className="mt-3 text-sm text-fb-text-secondary">{children}</div> : null}
      {actions ? <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{actions}</div> : null}
    </div>
  );
}

export { EmptyState };
