import { useIsMobile } from "@/hooks/use-is-mobile";
import { Image, Images, Import, Map as MapIcon, Route, Settings2, Trees } from "lucide-react";

import { PropertyHero3D } from "@/components/property-hero-3d";
import { MobileDock, Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import type { ProfileResponse } from "@/types";

type AppView = "map" | "planning" | "album" | "orthophotos" | "forest" | "import" | "video" | "settings";

interface AppSidebarProps {
  profile: ProfileResponse | null;
  activeView: AppView;
  isLoading: boolean;
  logoSpinActive?: boolean;
  onChangeView: (view: AppView) => void;
  onOpenMapFilters?: () => void;
  onStartMediaImport?: () => void;
}

function SidebarNavigation({
  activeView,
  onChangeView,
  onStartMediaImport,
}: Pick<AppSidebarProps, "activeView" | "onChangeView" | "onStartMediaImport">) {
  const isMobile = useIsMobile();
  if (isMobile) {
    const actions = [
      { view: "planning" as const, label: "Planlegging", detail: "Jorder og oppdrag", Icon: Route },
      { view: "orthophotos" as const, label: "Ortofoto", detail: "Se gården ovenfra", Icon: Image },
      { view: "forest" as const, label: "Skogbruk", detail: "Skog og terreng", Icon: Trees },
      ...(onStartMediaImport ? [{ view: "import" as const, label: "Importer", detail: "Legg til opptak", Icon: Import }] : []),
    ];
    return (
      <SidebarMenu className="fb-mobile-actions">
        {actions.map(({ view, label, detail, Icon }) => (
          <SidebarMenuItem key={view}>
            <SidebarMenuButton active={activeView === view} closeOnClick className="fb-mobile-action" onClick={() => view === "import" && onStartMediaImport ? onStartMediaImport() : onChangeView(view)}>
              <Icon className="h-5 w-5" />
              <span><span className="fb-mobile-action__title">{label}</span><span className="fb-mobile-action__detail">{detail}</span></span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    );
  }
  return (
    <nav aria-label="Hovednavigasjon">
      <SidebarMenu className="gap-1">
        <SidebarMenuItem>
          <SidebarMenuButton active={activeView === "map"} closeOnClick onClick={() => onChangeView("map")} className="fb-sidebar-menu-button h-11 rounded-xl px-3.5 text-[14px] font-medium">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-fb-text-secondary">
              <MapIcon className="h-4 w-4 shrink-0" />
            </span>
            <span className="fb-sidebar-label">Kart</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton active={activeView === "planning"} closeOnClick onClick={() => onChangeView("planning")} className="fb-sidebar-menu-button h-11 rounded-xl px-3.5 text-[14px] font-medium">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-fb-text-secondary">
              <Route className="h-4 w-4 shrink-0" />
            </span>
            <span className="fb-sidebar-label">Planlegging</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton active={activeView === "album"} closeOnClick onClick={() => onChangeView("album")} className="fb-sidebar-menu-button h-11 rounded-xl px-3.5 text-[14px] font-medium">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-fb-text-secondary">
              <Images className="h-4 w-4 shrink-0" />
            </span>
            <span className="fb-sidebar-label">Bibliotek</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton active={activeView === "orthophotos"} closeOnClick onClick={() => onChangeView("orthophotos")} className="fb-sidebar-menu-button h-11 rounded-xl px-3.5 text-[14px] font-medium">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-fb-text-secondary">
              <Image className="h-4 w-4 shrink-0" />
            </span>
            <span className="fb-sidebar-label">Ortofoto</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton active={activeView === "forest"} closeOnClick onClick={() => onChangeView("forest")} className="fb-sidebar-menu-button h-11 rounded-xl px-3.5 text-[14px] font-medium">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-fb-text-secondary">
              <Trees className="h-4 w-4 shrink-0" />
            </span>
            <span className="fb-sidebar-label">Skogbruk</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        {onStartMediaImport ? (
          <SidebarMenuItem>
            <SidebarMenuButton active={activeView === "import"} closeOnClick onClick={() => onStartMediaImport()} className="fb-sidebar-menu-button h-11 rounded-xl px-3.5 text-[14px] font-medium">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-fb-text-secondary">
                <Import className="h-4 w-4 shrink-0" />
              </span>
              <span className="fb-sidebar-label">Importer</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ) : null}
      </SidebarMenu>
    </nav>
  );
}

export function AppSidebar({
  profile,
  activeView,
  isLoading,
  logoSpinActive = false,
  onChangeView,
  onOpenMapFilters,
  onStartMediaImport,
}: AppSidebarProps) {
  const isMobile = useIsMobile();
  const logoUrl = `${import.meta.env.BASE_URL}flyvendebonder-logo.svg`;

  return (
    <Sidebar reserveDesktopWidth={activeView === "settings"} mobileDock={<MobileDock activeView={activeView} onChangeView={onChangeView} onOpenMapFilters={onOpenMapFilters} embedded />}>
      <SidebarHeader className="fb-sidebar-header px-5">
        {isMobile ? <div className="fb-mobile-menu-hero" aria-hidden="true"><PropertyHero3D profile={profile} variant="menu" /></div> : <div className="flex items-center gap-2">
          <a href={import.meta.env.BASE_URL} className="fb-sidebar-brand flex min-w-0 items-center gap-3 py-1 pl-3 pr-1 text-fb-text-primary">
            <span
              className={cn(
                "logo-hover-spin inline-flex h-9 w-9 items-center justify-center",
                (isLoading || logoSpinActive) && "logo-loading",
              )}
            >
              <img src={logoUrl} alt="" className="h-7 w-7" />
            </span>
            <span className="fb-sidebar-brand-text min-w-0 text-[15px] font-semibold leading-none tracking-[-0.01em]">
              Flyvendebønder
            </span>
          </a>
        </div>}
      </SidebarHeader>

      <SidebarContent className="gap-6 px-5 py-6">
        <SidebarNavigation activeView={activeView} onChangeView={onChangeView} onStartMediaImport={onStartMediaImport} />
      </SidebarContent>

      <SidebarFooter className="fb-sidebar-footer space-y-3 px-5">
        {!isMobile && activeView !== "settings" && <div className="fb-sidebar-profile-hero" aria-hidden="true">
          <PropertyHero3D profile={profile} variant="sidebar" />
        </div>}
        <SidebarMenuButton
          active={activeView === "settings"}
          closeOnClick
          onClick={() => onChangeView("settings")}
          aria-label="Innstillinger"
          className="fb-sidebar-settings-trigger h-11 w-full px-3.5 text-[14px] font-medium data-[active=true]:bg-transparent hover:bg-transparent"
        >
          <Settings2 className="h-5 w-5 shrink-0" />
          <span className="fb-sidebar-label">Innstillinger</span>
        </SidebarMenuButton>
      </SidebarFooter>
    </Sidebar>
  );
}
