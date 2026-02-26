import * as React from "react";

import { cn } from "@/lib/utils";

type GapScale = 1 | 2 | 3 | 4 | 5 | 6 | 8;
type ColScale = 1 | 2 | 3 | 4 | 5 | 6;

const gapClass: Record<GapScale, string> = {
  1: "gap-1",
  2: "gap-2",
  3: "gap-3",
  4: "gap-4",
  5: "gap-5",
  6: "gap-6",
  8: "gap-8",
};

const colsClass: Record<ColScale, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
  6: "grid-cols-6",
};

const smColsClass: Record<ColScale, string> = {
  1: "sm:grid-cols-1",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-4",
  5: "sm:grid-cols-5",
  6: "sm:grid-cols-6",
};

const lgColsClass: Record<ColScale, string> = {
  1: "lg:grid-cols-1",
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
  5: "lg:grid-cols-5",
  6: "lg:grid-cols-6",
};

const xlColsClass: Record<ColScale, string> = {
  1: "xl:grid-cols-1",
  2: "xl:grid-cols-2",
  3: "xl:grid-cols-3",
  4: "xl:grid-cols-4",
  5: "xl:grid-cols-5",
  6: "xl:grid-cols-6",
};

type MaxWidth = "content" | "wide" | "full";

const shellWidthClass: Record<MaxWidth, string> = {
  content: "max-w-[1120px]",
  wide: "max-w-[1360px]",
  full: "max-w-none",
};

interface PageShellProps extends React.HTMLAttributes<HTMLDivElement> {
  maxWidth?: MaxWidth;
}

function PageShell({ className, maxWidth = "content", ...props }: PageShellProps) {
  return <div className={cn("mx-auto w-full px-3 sm:px-6", shellWidthClass[maxWidth], className)} {...props} />;
}

interface SectionProps extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  compact?: boolean;
}

function Section({ className, title, description, actions, compact = false, children, ...props }: SectionProps) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-fb-border-subtle bg-fb-surface-base",
        compact ? "px-3 py-2.5 sm:px-4 sm:py-3" : "px-4 py-3 sm:px-5 sm:py-4",
        className,
      )}
      {...props}
    >
      {title || description || actions ? (
        <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            {title ? <h2 className="text-sm font-semibold text-fb-text-primary">{title}</h2> : null}
            {description ? <p className="text-xs text-fb-text-secondary">{description}</p> : null}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

interface StackProps extends React.HTMLAttributes<HTMLDivElement> {
  gap?: GapScale;
}

function Stack({ className, gap = 4, ...props }: StackProps) {
  return <div className={cn("flex flex-col", gapClass[gap], className)} {...props} />;
}

interface GridProps extends React.HTMLAttributes<HTMLDivElement> {
  cols?: ColScale;
  smCols?: ColScale;
  lgCols?: ColScale;
  xlCols?: ColScale;
  gap?: GapScale;
}

function Grid({ className, cols = 1, smCols, lgCols, xlCols, gap = 4, ...props }: GridProps) {
  return (
    <div
      className={cn(
        "grid",
        colsClass[cols],
        gapClass[gap],
        smCols ? smColsClass[smCols] : "",
        lgCols ? lgColsClass[lgCols] : "",
        xlCols ? xlColsClass[xlCols] : "",
        className,
      )}
      {...props}
    />
  );
}

function Divider({ className, ...props }: React.ComponentProps<"hr">) {
  return <hr className={cn("border-0 border-t border-fb-border-subtle", className)} {...props} />;
}

export { Divider, Grid, PageShell, Section, Stack };
