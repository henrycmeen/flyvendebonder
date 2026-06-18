import * as React from "react";

import { cn } from "@/lib/utils";

interface TextareaProps extends React.ComponentProps<"textarea"> {
  feedbackState?: "success" | "error";
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, feedbackState, ...props }, ref) => {
    const isAriaInvalid = props["aria-invalid"] === true || props["aria-invalid"] === "true";
    const computedState = isAriaInvalid ? "error" : feedbackState;

    return (
      <textarea
        className={cn(
          "flex min-h-[88px] w-full rounded-md border border-fb-border-subtle bg-fb-surface-base px-3 py-2 text-sm text-fb-text-primary placeholder:text-fb-text-muted transition-[border-color,box-shadow,background-color] duration-[var(--fb-motion-duration-small)] ease-[var(--fb-motion-easing-standard)] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fb-season-solid aria-[invalid=true]:border-[color:var(--fb-accent-danger)] aria-[invalid=true]:focus-visible:ring-[color:var(--fb-accent-danger)] data-[state=success]:!border-[color:var(--fb-accent-emerald)] data-[state=success]:!focus-visible:ring-[color:var(--fb-accent-emerald)] data-[state=error]:!border-[color:var(--fb-accent-danger)] data-[state=error]:!focus-visible:ring-[color:var(--fb-accent-danger)] disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        data-state={computedState}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
