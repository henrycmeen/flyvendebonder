import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const surfaceVariants = cva("fb-glass-surface rounded-2xl border text-fb-text-primary", {
  variants: { surface: {
    content: "fb-glass-surface--content",
    floating: "fb-glass-surface--floating",
    navigation: "fb-glass-surface--navigation",
  } }, defaultVariants: { surface: "content" },
});
export interface GlassSurfaceProps extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof surfaceVariants> {}
export function GlassSurface({ surface, className, ...props }: GlassSurfaceProps) {
  return <div className={cn(surfaceVariants({ surface }), className)} {...props} />;
}
