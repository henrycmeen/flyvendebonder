import * as React from "react";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { Images, Map as MapIcon, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";

import * as DialogPrimitive from "@radix-ui/react-dialog";

import { Sheet, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

interface SidebarContextValue {
  isMobile: boolean;
  openMobile: boolean;
  setOpenMobile: React.Dispatch<React.SetStateAction<boolean>>;
  mobileTriggerRef: React.RefObject<HTMLButtonElement | null>;
  collapsedDesktop: boolean;
  toggleDesktop: () => void;
}

const SidebarContext = React.createContext<SidebarContextValue | null>(null);

function SidebarProvider({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();
  const mobileTriggerRef = React.useRef<HTMLButtonElement | null>(null);
  const [openMobile, setOpenMobile] = React.useState(false);
  const [collapsedDesktop, setCollapsedDesktop] = React.useState(true);

  React.useEffect(() => {
    if (!isMobile) {
      setOpenMobile(false);
    }
  }, [isMobile]);

  return (
    <SidebarContext.Provider
      value={{
        isMobile,
        openMobile,
        setOpenMobile,
        mobileTriggerRef,
        collapsedDesktop,
        toggleDesktop: () => setCollapsedDesktop((current) => !current),
      }}
    >
      {children}
    </SidebarContext.Provider>
  );
}

function useSidebar() {
  const context = React.useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within SidebarProvider");
  }
  return context;
}

function Sidebar({ className, children }: React.HTMLAttributes<HTMLElement>) {
  const { isMobile, openMobile, setOpenMobile, collapsedDesktop, mobileTriggerRef } = useSidebar();
  const [desktopHovered, setDesktopHovered] = React.useState(false);
  const effectiveCollapsed = collapsedDesktop && !desktopHovered;
  const content = (
    <div
      className={cn(
        "fb-sidebar-shell flex h-full flex-col overflow-hidden bg-[color:var(--fb-surface-ghost)]/96",
        className,
      )}
    >
      {children}
    </div>
  );

  if (isMobile) {
    return (
      <Sheet open={openMobile} onOpenChange={setOpenMobile}>
        <SheetContent side="left" className="fb-mobile-menu bg-fb-surface-page" onCloseAutoFocus={(event) => { event.preventDefault(); mobileTriggerRef.current?.focus(); }}>
          <DialogPrimitive.Title className="sr-only">Hovedmeny</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Navigasjon og innstillinger for Flyvendebønder.
          </DialogPrimitive.Description>
          {content}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <aside
      data-collapsed={effectiveCollapsed ? "true" : "false"}
      onMouseEnter={() => setDesktopHovered(true)}
      onMouseLeave={() => setDesktopHovered(false)}
      onFocusCapture={() => setDesktopHovered(true)}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget;
        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
          return;
        }
        setDesktopHovered(false);
      }}
      className={cn(
        "fb-sidebar hidden h-screen shrink-0 transition-[width] duration-[var(--fb-motion-duration-medium)] ease-[var(--fb-motion-easing-standard)] md:flex md:flex-col",
        effectiveCollapsed ? "w-[5.5rem]" : "w-[18.75rem]",
      )}
    >
      {content}
    </aside>
  );
}

function SidebarHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("border-b border-fb-border-subtle/70 px-4 py-4", className)} {...props} />;
}

function SidebarContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-4", className)} {...props} />;
}

function SidebarFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("border-t border-fb-border-subtle/70 px-3 py-3", className)} {...props} />;
}

function SidebarInset({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return <main className={cn("relative flex min-w-0 flex-1 flex-col overflow-hidden", className)} {...props} />;
}

function SidebarMenu({ className, ...props }: React.HTMLAttributes<HTMLUListElement>) {
  return <ul className={cn("flex flex-col gap-1", className)} {...props} />;
}

function SidebarMenuItem({ className, ...props }: React.HTMLAttributes<HTMLLIElement>) {
  return <li className={cn("list-none", className)} {...props} />;
}

interface SidebarMenuButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  closeOnClick?: boolean;
}

function SidebarMenuButton({ className, active = false, closeOnClick = false, onClick, ...props }: SidebarMenuButtonProps) {
  const { isMobile, setOpenMobile } = useSidebar();

  return (
    <button
      type="button"
      data-active={active ? "true" : "false"}
      className={cn(
        "flex w-full items-center gap-3 text-left text-sm font-medium text-fb-text-secondary transition-[background-color,color,box-shadow,transform] duration-[var(--fb-motion-duration-medium)] ease-[var(--fb-motion-easing-standard)] hover:bg-white/34 hover:text-fb-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fb-season-solid data-[active=true]:bg-white/72 data-[active=true]:text-fb-text-primary data-[active=true]:shadow-[inset_0_1px_0_rgba(255,255,255,0.52),0_8px_18px_rgba(35,48,56,0.08)]",
        className,
      )}
      onClick={(event) => {
        onClick?.(event);
        if (closeOnClick && isMobile) {
          setOpenMobile(false);
        }
      }}
      {...props}
    />
  );
}

function SidebarTrigger({ className, onClick, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { setOpenMobile } = useSidebar();

  return (
    <button
      type="button"
      className={className}
      onClick={(event) => {
        onClick?.(event);
        setOpenMobile(true);
      }}
      {...props}
    />
  );
}

function SidebarCollapseTrigger({ className, onClick, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { toggleDesktop } = useSidebar();

  return (
    <button
      type="button"
      className={className}
      onClick={(event) => {
        onClick?.(event);
        toggleDesktop();
      }}
      {...props}
    />
  );
}

function SidebarGroupLabel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("px-3 pb-2 text-xs font-semibold uppercase tracking-[0.08em] text-fb-text-muted", className)}
      {...props}
    />
  );
}

function MobileDock({ activeView, onChangeView }: { activeView: string; onChangeView: (view: "map" | "album") => void }) {
  const { isMobile, openMobile, setOpenMobile, mobileTriggerRef } = useSidebar();
  if (!isMobile) return null;
  return (
    <nav className="fb-mobile-dock" aria-label="Hovednavigasjon">
      <Button variant="ghost" className="fb-mobile-dock__item" aria-current={activeView === "map" ? "page" : undefined} onClick={() => onChangeView("map")}>
        <MapIcon className="h-5 w-5" /><span>Kart</span>
      </Button>
      <Button variant="ghost" className="fb-mobile-dock__item" aria-current={activeView === "album" ? "page" : undefined} onClick={() => onChangeView("album")}>
        <Images className="h-5 w-5" /><span>Bibliotek</span>
      </Button>
      <Button ref={mobileTriggerRef} variant="ghost" className="fb-mobile-dock__item" aria-current={activeView !== "map" && activeView !== "album" ? "page" : undefined} aria-expanded={openMobile} aria-label="Mer – åpne meny" onClick={() => setOpenMobile((current) => !current)}>
        <MoreHorizontal className="h-5 w-5" /><span>Mer</span>
      </Button>
    </nav>
  );
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarCollapseTrigger,
  SidebarTrigger,
  MobileDock,
};
