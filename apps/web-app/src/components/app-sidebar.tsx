import { Images, Import, Map as MapIcon, Route, Settings2 } from "lucide-react";

import { SettingsDialog } from "@/components/settings-dialog";
import { Button } from "@/components/ui/button";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import type { BaseMapStyle } from "@/lib/map-styles";
import { cn } from "@/lib/utils";
import type { AdminSessionStatus, ProfileResponse } from "@/types";

type AppView = "map" | "planning" | "album" | "import" | "video";

interface LogEntry {
  id: string;
  time: string;
  level: "info" | "warn" | "error";
  message: string;
  requestId?: string | null;
  details?: string;
}

interface BackendLogEntry {
  timestamp: string;
  level: string;
  logger: string;
  requestId?: string | null;
  request_id?: string | null;
  message: string;
  raw: string;
}

interface SavePayload {
  user: {
    full_name?: string;
    phone?: string;
    email?: string;
    address_line1?: string;
    postal_code?: string;
    city?: string;
    municipality_code?: string;
    municipality_name?: string;
  };
  property: {
    komm?: string;
    gnr?: number;
    bnr?: number;
    fnr?: number;
    label?: string;
  };
  additional_properties: Array<{
    id?: number;
    komm: string;
    gnr: number;
    bnr: number;
    fnr?: number;
    label?: string;
  }>;
}

interface AppSidebarProps {
  profile: ProfileResponse | null;
  adminStatus: AdminSessionStatus | null;
  adminBusy: boolean;
  activeView: AppView;
  statusText: string;
  propertyStatus: string;
  soilStatus: string;
  showSoilLayer: boolean;
  showPropertyLayer: boolean;
  showOnlyManualQc: boolean;
  showOnlyLowConfidence: boolean;
  baseMapStyle: BaseMapStyle;
  mapGrayscale: boolean;
  mapVintage: boolean;
  showZoomControls: boolean;
  isLoading: boolean;
  logoSpinActive?: boolean;
  logs: LogEntry[];
  onClearLogs: () => void;
  backendLogs: BackendLogEntry[];
  backendLogsLoading: boolean;
  onFetchBackendLogs: () => void;
  onClearBackendLogs: () => void;
  onToggleSoilLayer: (next: boolean) => void;
  onTogglePropertyLayer: (next: boolean) => void;
  onToggleManualQcFilter: (next: boolean) => void;
  onToggleLowConfidenceFilter: (next: boolean) => void;
  onChangeBaseMapStyle: (style: BaseMapStyle) => void;
  onChangeMapGrayscale: (next: boolean) => void;
  onChangeMapVintage: (next: boolean) => void;
  onChangeShowZoomControls: (next: boolean) => void;
  onChangeView: (view: AppView) => void;
  onStartMediaImport?: () => void;
  onSaveProfile: (payload: SavePayload) => Promise<void>;
  onAdminLogin: (code: string) => Promise<void>;
  onAdminLogout: () => Promise<void>;
}

function SidebarNavigation({
  activeView,
  onChangeView,
  onStartMediaImport,
}: Pick<AppSidebarProps, "activeView" | "onChangeView" | "onStartMediaImport">) {
  return (
    <>
      <SidebarMenu className="gap-2">
        <SidebarMenuItem>
          <SidebarMenuButton active={activeView === "map"} closeOnClick onClick={() => onChangeView("map")} className="fb-sidebar-menu-button h-12 rounded-2xl px-3.5 text-[14px] font-medium">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-fb-text-secondary">
              <MapIcon className="h-4 w-4 shrink-0" />
            </span>
            <span className="fb-sidebar-label">Kart</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton active={activeView === "planning"} closeOnClick onClick={() => onChangeView("planning")} className="fb-sidebar-menu-button h-12 rounded-2xl px-3.5 text-[14px] font-medium">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-fb-text-secondary">
              <Route className="h-4 w-4 shrink-0" />
            </span>
            <span className="fb-sidebar-label">Planlegging</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton active={activeView === "album"} closeOnClick onClick={() => onChangeView("album")} className="fb-sidebar-menu-button h-12 rounded-2xl px-3.5 text-[14px] font-medium">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-fb-text-secondary">
              <Images className="h-4 w-4 shrink-0" />
            </span>
            <span className="fb-sidebar-label">Album</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        {onStartMediaImport ? (
          <SidebarMenuItem>
            <SidebarMenuButton active={activeView === "import"} closeOnClick onClick={() => onStartMediaImport()} className="fb-sidebar-menu-button h-12 rounded-2xl px-3.5 text-[14px] font-medium">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-fb-text-secondary">
                <Import className="h-4 w-4 shrink-0" />
              </span>
              <span className="fb-sidebar-label">Import</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ) : null}
      </SidebarMenu>
    </>
  );
}

export function AppSidebar({
  profile,
  adminStatus,
  adminBusy,
  activeView,
  statusText,
  propertyStatus,
  soilStatus,
  showSoilLayer,
  showPropertyLayer,
  showOnlyManualQc,
  showOnlyLowConfidence,
  baseMapStyle,
  mapGrayscale,
  mapVintage,
  showZoomControls,
  isLoading,
  logoSpinActive = false,
  logs,
  onClearLogs,
  backendLogs,
  backendLogsLoading,
  onFetchBackendLogs,
  onClearBackendLogs,
  onToggleSoilLayer,
  onTogglePropertyLayer,
  onToggleManualQcFilter,
  onToggleLowConfidenceFilter,
  onChangeBaseMapStyle,
  onChangeMapGrayscale,
  onChangeMapVintage,
  onChangeShowZoomControls,
  onChangeView,
  onStartMediaImport,
  onSaveProfile,
  onAdminLogin,
  onAdminLogout,
}: AppSidebarProps) {
  const logoUrl = `${import.meta.env.BASE_URL}flyvendebonder-logo.svg`;

  return (
    <Sidebar>
      <SidebarHeader className="fb-sidebar-header px-5">
        <div className="flex items-center gap-2">
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
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-6 px-5 py-6">
        <SidebarNavigation activeView={activeView} onChangeView={onChangeView} onStartMediaImport={onStartMediaImport} />
      </SidebarContent>

      <SidebarFooter className="fb-sidebar-footer space-y-3 px-5">
        <SettingsDialog
          profile={profile}
          adminStatus={adminStatus}
          adminBusy={adminBusy}
          statusText={statusText}
          propertyStatus={propertyStatus}
          soilStatus={soilStatus}
          showSoilLayer={showSoilLayer}
          showPropertyLayer={showPropertyLayer}
          showOnlyManualQc={showOnlyManualQc}
          showOnlyLowConfidence={showOnlyLowConfidence}
          baseMapStyle={baseMapStyle}
          mapGrayscale={mapGrayscale}
          mapVintage={mapVintage}
          showZoomControls={showZoomControls}
          logs={logs}
          onClearLogs={onClearLogs}
          backendLogs={backendLogs}
          backendLogsLoading={backendLogsLoading}
          onFetchBackendLogs={onFetchBackendLogs}
          onClearBackendLogs={onClearBackendLogs}
          onToggleSoilLayer={onToggleSoilLayer}
          onTogglePropertyLayer={onTogglePropertyLayer}
          onToggleManualQcFilter={onToggleManualQcFilter}
          onToggleLowConfidenceFilter={onToggleLowConfidenceFilter}
          onChangeBaseMapStyle={onChangeBaseMapStyle}
          onChangeMapGrayscale={onChangeMapGrayscale}
          onChangeMapVintage={onChangeMapVintage}
          onChangeShowZoomControls={onChangeShowZoomControls}
          onSaveProfile={onSaveProfile}
          onAdminLogin={onAdminLogin}
          onAdminLogout={onAdminLogout}
          trigger={
            <Button type="button" variant="ghost" className="fb-sidebar-settings-trigger h-12 w-full justify-start rounded-2xl px-3.5 text-[14px] font-medium text-fb-text-primary">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-fb-text-secondary">
                <Settings2 className="h-4 w-4 shrink-0" />
              </span>
              <span className="fb-sidebar-label">{profile?.property?.label ?? "Meen gård"}</span>
            </Button>
          }
        />
      </SidebarFooter>
    </Sidebar>
  );
}
