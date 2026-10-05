import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { CloseButton } from "@/components/ui/close-button";
import { cn } from "@/lib/utils";

const Sheet = DialogPrimitive.Root;
const SheetTrigger = DialogPrimitive.Trigger;
const SheetClose = DialogPrimitive.Close;
const SheetPortal = DialogPrimitive.Portal;

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fb-sheet-overlay fixed inset-0 z-[1180] bg-[color:var(--fb-surface-overlay)]/80 backdrop-blur-sm transition-opacity motion-reduce:transition-none data-[state=open]:opacity-100 data-[state=closed]:opacity-0",
      className,
    )}
    {...props}
  />
));
SheetOverlay.displayName = DialogPrimitive.Overlay.displayName;

interface SheetContentProps extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  side?: "left" | "right";
}

const sideVariants: Record<NonNullable<SheetContentProps["side"]>, string> = {
  left:
    "inset-y-2 left-2 h-auto max-h-[calc(100dvh-1rem)] w-[min(21rem,calc(100vw-1rem))] rounded-[28px] border data-[state=open]:translate-x-0 data-[state=closed]:-translate-x-full",
  right:
    "inset-y-2 right-2 h-auto max-h-[calc(100dvh-1rem)] w-[min(21rem,calc(100vw-1rem))] rounded-[28px] border data-[state=open]:translate-x-0 data-[state=closed]:translate-x-full",
};

const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(({ className, children, side = "left", ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed z-[1190] bg-fb-surface-page p-0 shadow-fb-raised transition-transform duration-[var(--fb-motion-duration-medium)] ease-[var(--fb-motion-easing-decelerate)] motion-reduce:transition-none",
        sideVariants[side],
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close asChild>
        <CloseButton className="absolute right-3 top-3 md:hidden" label="Lukk meny" />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </SheetPortal>
));
SheetContent.displayName = DialogPrimitive.Content.displayName;

export { Sheet, SheetClose, SheetContent, SheetPortal, SheetTrigger };
