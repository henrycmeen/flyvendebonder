import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cn } from "@/lib/utils";

const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 8, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-[1200] overflow-hidden rounded-md border border-fb-border-subtle bg-fb-surface-base px-3 py-1.5 text-xs text-fb-text-primary shadow-soft transition-[opacity,transform] will-change-[transform,opacity] motion-reduce:transition-none data-[state=closed]:opacity-0 data-[state=closed]:translate-y-0.5 data-[state=delayed-open]:opacity-100 data-[state=delayed-open]:translate-y-0 data-[state=instant-open]:opacity-100 data-[state=instant-open]:translate-y-0 data-[state=closed]:duration-[var(--fb-motion-duration-small)] data-[state=closed]:ease-[var(--fb-motion-easing-accelerate)] data-[state=delayed-open]:duration-[var(--fb-motion-duration-medium)] data-[state=delayed-open]:ease-[var(--fb-motion-easing-decelerate)] data-[state=instant-open]:duration-[var(--fb-motion-duration-medium)] data-[state=instant-open]:ease-[var(--fb-motion-easing-decelerate)]",
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
