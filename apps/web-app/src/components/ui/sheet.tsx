import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

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
      "fixed inset-0 z-50 bg-[color:var(--fb-surface-overlay)]/80 backdrop-blur-sm transition-opacity motion-reduce:transition-none data-[state=open]:opacity-100 data-[state=closed]:opacity-0",
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
    "inset-y-0 left-0 h-full w-[min(20rem,calc(100vw-1.5rem))] border-r data-[state=open]:translate-x-0 data-[state=closed]:-translate-x-full",
  right:
    "inset-y-0 right-0 h-full w-[min(20rem,calc(100vw-1.5rem))] border-l data-[state=open]:translate-x-0 data-[state=closed]:translate-x-full",
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
        "fixed z-50 bg-fb-surface-page p-0 shadow-fb-raised transition-transform duration-[var(--fb-motion-duration-medium)] ease-[var(--fb-motion-easing-decelerate)] motion-reduce:transition-none",
        sideVariants[side],
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-md text-fb-text-secondary transition-colors hover:bg-fb-surface-ghost hover:text-fb-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fb-season-solid md:hidden">
        <X className="h-4 w-4" />
        <span className="sr-only">Lukk meny</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </SheetPortal>
));
SheetContent.displayName = DialogPrimitive.Content.displayName;

export { Sheet, SheetClose, SheetContent, SheetPortal, SheetTrigger };
