import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex min-h-10 items-center justify-center rounded-lg max-sm:min-h-[50px] max-sm:p-0.5 border border-fb-border-subtle bg-fb-surface-ghost p-1 text-fb-text-secondary",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex h-8 items-center justify-center whitespace-nowrap rounded-md max-sm:h-11 px-3 py-1.5 text-sm font-medium transition-[background-color,color,box-shadow] duration-[var(--fb-motion-duration-micro)] ease-[var(--fb-motion-easing-standard)] motion-reduce:transition-none enabled:hover:bg-fb-surface-base enabled:hover:text-fb-text-primary enabled:active:bg-fb-border-subtle disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fb-season-solid data-[state=active]:bg-fb-surface-base data-[state=active]:text-fb-text-primary",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn("mt-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fb-season-solid", className)}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsContent, TabsList, TabsTrigger };
