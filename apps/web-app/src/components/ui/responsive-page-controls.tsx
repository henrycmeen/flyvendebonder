import { useContext, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageControlsContext } from "@/hooks/use-page-controls";
import { useIsMobile } from "@/hooks/use-is-mobile";

type ResponsivePageControlsProps = {
  children: ReactNode;
  label?: string;
  active?: boolean;
  summary?: ReactNode;
};

export function ResponsivePageControls({ children, label = "Filtrer og sorter", active = false, summary }: ResponsivePageControlsProps) {
  const isMobile = useIsMobile();
  const target = useContext(PageControlsContext);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const triggerId = `${panelId}-trigger`;
  const triggerRef = useRef<HTMLButtonElement>(null);

  if (isMobile) {
    if (!target) return null;
    return createPortal(
      <div
        className="fb-page-controls-mobile"
        data-state={open ? "open" : "closed"}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open && !event.defaultPrevented) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            triggerRef.current?.focus();
          }
        }}
      >
        <Button
          ref={triggerRef}
          id={triggerId}
          type="button"
          variant="ghost"
          className="fb-page-controls-trigger"
          data-state={open ? "open" : "closed"}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((current) => !current)}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          <span>{label}</span>
          {!open && summary && <span className="fb-page-controls-summary">{summary}</span>}
          {active && <span className="fb-page-controls-active">Aktivt</span>}
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        </Button>
        <div
          id={panelId}
          role="region"
          aria-labelledby={triggerId}
          className="fb-page-controls-body"
          data-state={open ? "open" : "closed"}
          hidden={!open}
        >
          {children}
        </div>
      </div>, target,
    );
  }
  return <div className="border-b border-fb-border-subtle bg-fb-surface-base py-2">{children}</div>;
}
