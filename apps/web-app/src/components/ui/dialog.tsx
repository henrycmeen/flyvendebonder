import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { CloseButton } from "@/components/ui/close-button";
import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-[1280] bg-[color:var(--fb-surface-overlay)] transition-opacity motion-reduce:transition-none data-[state=open]:opacity-100 data-[state=closed]:opacity-0 data-[state=open]:duration-[var(--fb-motion-duration-medium)] data-[state=open]:ease-[var(--fb-motion-easing-decelerate)] data-[state=closed]:duration-[var(--fb-motion-duration-small)] data-[state=closed]:ease-[var(--fb-motion-easing-accelerate)]",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-1/2 top-1/2 z-[1290] grid w-[95vw] max-w-2xl gap-4 rounded-xl border border-fb-border-subtle bg-fb-surface-base p-6 shadow-soft transition-[opacity,transform] motion-reduce:transition-none data-[state=open]:opacity-100 data-[state=closed]:opacity-0 data-[state=open]:[transform:translate(-50%,-50%)] data-[state=closed]:[transform:translate(-50%,calc(-50%+4px))] data-[state=open]:duration-[var(--fb-motion-duration-large)] data-[state=open]:ease-[var(--fb-motion-easing-decelerate)] data-[state=closed]:duration-[var(--fb-motion-duration-small)] data-[state=closed]:ease-[var(--fb-motion-easing-accelerate)]",
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close asChild>
        <CloseButton className="absolute right-4 top-4" label="Lukk dialog" />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col space-y-1.5 text-left", className)} {...props} />;
}

function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />;
}

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn("text-lg font-semibold leading-none", className)} {...props} />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("text-sm text-fb-text-secondary", className)} {...props} />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
