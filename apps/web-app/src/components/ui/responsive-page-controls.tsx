import { useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { PageControlsContext } from "@/hooks/use-page-controls";
import { useIsMobile } from "@/hooks/use-is-mobile";

export function ResponsivePageControls({ children, label = "Filtrer og sorter", active = false }: { children: ReactNode; label?: string; active?: boolean }) {
  const isMobile = useIsMobile();
  const target = useContext(PageControlsContext);
  if (isMobile) {
    if (!target) return null;
    return createPortal(
      <details className="fb-page-controls-mobile" onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.currentTarget.open = false;
          event.currentTarget.querySelector("summary")?.focus();
        }
      }}>
        <summary><SlidersHorizontal className="h-4 w-4" /><span>{label}</span>{active && <span className="fb-page-controls-active">Aktivt</span>}<ChevronDown className="h-4 w-4" /></summary>
        <div className="fb-page-controls-body">{children}</div>
      </details>, target,
    );
  }
  return <div className="fb-page-toolbar">{children}</div>;
}
