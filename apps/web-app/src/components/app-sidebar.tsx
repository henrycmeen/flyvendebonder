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
  const groups = [
    {
      label: "Gården",
      items: [
        { view: "map" as const, label: "Kart", Icon: MapIcon },
        { view: "planning" as const, label: "Planlegging", Icon: Route },
        { view: "forest" as const, label: "Skogbruk", Icon: Trees },
      ],
    },
    {
      label: "Bibliotek",
      items: [
        { view: "album" as const, label: "Bilder", Icon: Images },
        { view: "orthophotos" as const, label: "Ortofoto", Icon: Image },
        ...(onStartMediaImport ? [{ view: "import" as const, label: "Importer", Icon: Import }] : []),
      ],
    },
  ];

  return (
    <nav aria-label="Hovednavigasjon" className="fb-sidebar-navigation space-y-5">
      {groups.map(({ label, items }) => (
        <div key={label} role="group" aria-label={label}>
          <div aria-hidden="true" className="fb-sidebar-group-label mb-2 px-3.5 text-xs font-medium text-fb-text-secondary">
            {label}
          </div>
          <SidebarMenu className={isMobile ? "fb-mobile-actions" : "gap-1"}>
            {items.filter(({ view }) => !isMobile || (view !== "map" && view !== "album")).map(({ view, label: itemLabel, Icon }) => (
              <SidebarMenuItem key={view}>
                <SidebarMenuButton
                  active={activeView === view}
                  closeOnClick
                  aria-label={itemLabel}
                  className={isMobile ? "fb-mobile-action" : "fb-sidebar-menu-button h-11 rounded-xl px-3.5 text-[14px] font-medium"}
                  onClick={() => view === "import" && onStartMediaImport ? onStartMediaImport() : onChangeView(view)}
                >
                  {isMobile ? <Icon className="h-5 w-5" /> : (
                    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-fb-text-secondary">
                      <Icon className="h-4 w-4 shrink-0" />
                    </span>
                  )}
                  <span className={isMobile ? "fb-mobile-action__title" : "fb-sidebar-label"}>{itemLabel}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </div>
      ))}
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
    <Sidebar mobileDock={<MobileDock activeView={activeView} onChangeView={onChangeView} onOpenMapFilters={onOpenMapFilters} embedded />}>
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
