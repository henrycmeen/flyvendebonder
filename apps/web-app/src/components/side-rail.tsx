import { type FormEvent, useEffect, useMemo, useState } from "react";
import { FolderKanban, Images, Map as MapIcon } from "lucide-react";

import type { ProfileResponse } from "@/types";
import { cn } from "@/lib/utils";
import { BASE_MAP_STYLE_ORDER, BASE_MAP_STYLES, type BaseMapStyle } from "@/lib/map-styles";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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
}

type AppView = "map" | "album";
type UiTheme = "standard" | "satellite";

interface SideRailProps {
  profile: ProfileResponse | null;
  activeView: AppView;
  uiTheme: UiTheme;
  statusText: string;
  propertyStatus: string;
  showPropertyLayer: boolean;
  baseMapStyle: BaseMapStyle;
  mapGrayscale: boolean;
  mapVintage: boolean;
  showOnlyManualQc: boolean;
  showOnlyLowConfidence: boolean;
  isLoading: boolean;
  logoSpinActive?: boolean;
  logs: LogEntry[];
  onClearLogs: () => void;
  backendLogs: BackendLogEntry[];
  backendLogsLoading: boolean;
  onFetchBackendLogs: () => void;
  onClearBackendLogs: () => void;
  onTogglePropertyLayer: (next: boolean) => void;
  onChangeBaseMapStyle: (style: BaseMapStyle) => void;
  onChangeMapGrayscale: (next: boolean) => void;
  onChangeMapVintage: (next: boolean) => void;
  onChangeView: (view: AppView) => void;
  onToggleManualQcFilter: (next: boolean) => void;
  onToggleLowConfidenceFilter: (next: boolean) => void;
  onSaveProfile: (payload: SavePayload) => Promise<void>;
}

interface FormState {
  full_name: string;
  phone: string;
  email: string;
  address_line1: string;
  postal_code: string;
  city: string;
  municipality_code: string;
  municipality_name: string;
  komm: string;
  gnr: string;
  bnr: string;
  fnr: string;
  label: string;
}

const emptyFormState: FormState = {
  full_name: "",
  phone: "",
  email: "",
  address_line1: "",
  postal_code: "",
  city: "",
  municipality_code: "",
  municipality_name: "",
  komm: "",
  gnr: "",
  bnr: "",
  fnr: "",
  label: "",
};

function toFormState(profile: ProfileResponse | null): FormState {
  if (!profile) return emptyFormState;

  return {
    full_name: profile.user.full_name ?? "",
    phone: profile.user.phone ?? "",
    email: profile.user.email ?? "",
    address_line1: profile.user.address_line1 ?? "",
    postal_code: profile.user.postal_code ?? "",
    city: profile.user.city ?? "",
    municipality_code: profile.user.municipality_code ?? "",
    municipality_name: profile.user.municipality_name ?? "",
    komm: profile.property?.komm ?? "",
    gnr: profile.property?.gnr != null ? String(profile.property.gnr) : "",
    bnr: profile.property?.bnr != null ? String(profile.property.bnr) : "",
    fnr: profile.property?.fnr != null ? String(profile.property.fnr) : "",
    label: profile.property?.label ?? "",
  };
}

function toNumberOrUndefined(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function SideRail({
  profile,
  activeView,
  uiTheme,
  statusText,
  propertyStatus,
  showPropertyLayer,
  baseMapStyle,
  mapGrayscale,
  mapVintage,
  showOnlyManualQc,
  showOnlyLowConfidence,
  isLoading,
  logoSpinActive = false,
  logs,
  onClearLogs,
  backendLogs,
  backendLogsLoading,
  onFetchBackendLogs,
  onClearBackendLogs,
  onTogglePropertyLayer,
  onChangeBaseMapStyle,
  onChangeMapGrayscale,
  onChangeMapVintage,
  onChangeView,
  onToggleManualQcFilter,
  onToggleLowConfidenceFilter,
  onSaveProfile,
}: SideRailProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formState, setFormState] = useState<FormState>(toFormState(profile));

  useEffect(() => {
    setFormState(toFormState(profile));
  }, [profile]);

  const propertyLabel = useMemo(() => {
    if (!profile?.property) return "Ingen aktiv eiendom";
    return `${profile.property.komm}-${profile.property.gnr}/${profile.property.bnr}/${profile.property.fnr}`;
  }, [profile]);
  const initials = useMemo(() => {
    const name = profile?.user.full_name?.trim();
    if (!name) return "RM";
    const parts = name.split(/\s+/).slice(0, 2);
    return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "RM";
  }, [profile?.user.full_name]);

  const logoUrl = `${import.meta.env.BASE_URL}flyvendebonder-logo.svg`;

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);

    try {
      await onSaveProfile({
        user: {
          full_name: formState.full_name,
          phone: formState.phone,
          email: formState.email,
          address_line1: formState.address_line1,
          postal_code: formState.postal_code,
          city: formState.city,
          municipality_code: formState.municipality_code,
          municipality_name: formState.municipality_name,
        },
        property: {
          komm: formState.komm,
          gnr: toNumberOrUndefined(formState.gnr),
          bnr: toNumberOrUndefined(formState.bnr),
          fnr: toNumberOrUndefined(formState.fnr),
          label: formState.label,
        },
      });
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Card
        className={cn(
          "side-rail pointer-events-auto fixed inset-y-0 left-0 z-[900] w-[62px] overflow-hidden rounded-none rounded-br-[28px] border-b-0 border-l-0 border-r border-t-0 shadow-none sm:w-[68px]",
          uiTheme === "satellite" && "side-rail--satellite border-r-black/30",
        )}
      >
        <CardContent className="flex h-full flex-col items-center px-1.5 pb-3 pt-3">
          <a
            href={import.meta.env.BASE_URL}
            className={cn(
              "logo-hover-spin inline-flex h-9 w-9 items-center justify-center text-earth-900",
              (isLoading || logoSpinActive) && "logo-loading",
            )}
            aria-label="Gå til start i appen"
          >
            <img src={logoUrl} alt="" className="h-7 w-7" />
          </a>

          <div className="mt-6 flex min-h-0 flex-1 flex-col items-center">
            <div className="flex flex-col items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-9 w-9 rounded-lg hover:bg-black/5",
                      uiTheme === "satellite" ? "text-white hover:bg-white/10" : "text-[#111111]",
                      activeView === "map" &&
                        (uiTheme === "satellite"
                          ? "border border-black/35 bg-black/34 text-white hover:bg-black/44"
                          : "border border-earth-500/40 bg-paper/75"),
                    )}
                    onClick={() => onChangeView("map")}
                    aria-label="Kartvisning"
                  >
                    <MapIcon className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">Kart</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-9 w-9 rounded-lg hover:bg-black/5",
                      uiTheme === "satellite" ? "text-white hover:bg-white/10" : "text-[#111111]",
                      activeView === "album" &&
                        (uiTheme === "satellite"
                          ? "border border-black/35 bg-black/34 text-white hover:bg-black/44"
                          : "border border-earth-500/40 bg-paper/75"),
                    )}
                    onClick={() => onChangeView("album")}
                    aria-label="Albumvisning"
                  >
                    <Images className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">Album</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-9 w-9 rounded-lg border border-transparent hover:bg-black/5",
                      uiTheme === "satellite" ? "text-white hover:bg-white/10" : "text-[#111111]",
                    )}
                    onClick={() => {
                      window.location.href = "/";
                    }}
                    aria-label="Prosjektstatus"
                  >
                    <FolderKanban className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">Prosjektstatus</TooltipContent>
              </Tooltip>
            </div>

            <div className="mt-4 flex flex-col items-center pb-1">
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#d96505] text-xs font-medium text-white shadow-[0_8px_20px_rgba(217,101,5,0.35)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-earth-700"
                    aria-label="Åpne profilinnstillinger"
                  >
                    {initials}
                  </button>
                </DialogTrigger>

              <DialogContent className="max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Innstillinger</DialogTitle>
                  <DialogDescription>Profil, kartlag og teknisk logg.</DialogDescription>
                </DialogHeader>

                <Tabs defaultValue="profile" className="w-full">
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="profile">Profil</TabsTrigger>
                    <TabsTrigger value="layer">Kartlag</TabsTrigger>
                    <TabsTrigger value="log">Teknisk logg</TabsTrigger>
                  </TabsList>

                  <TabsContent value="profile">
                    <form className="grid gap-4" onSubmit={onSubmit}>
                      <div className="grid gap-2 rounded-lg border border-earth-500/25 bg-paper/60 p-3">
                        <h3 className="text-sm font-semibold text-earth-900">Kundeprofil</h3>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div className="grid gap-1.5">
                            <Label htmlFor="full_name">Navn</Label>
                            <Input
                              id="full_name"
                              value={formState.full_name}
                              onChange={(event) => setFormState((prev) => ({ ...prev, full_name: event.target.value }))}
                              required
                            />
                          </div>
                          <div className="grid gap-1.5">
                            <Label htmlFor="phone">Telefon</Label>
                            <Input
                              id="phone"
                              value={formState.phone}
                              onChange={(event) => setFormState((prev) => ({ ...prev, phone: event.target.value }))}
                            />
                          </div>
                          <div className="grid gap-1.5">
                            <Label htmlFor="address_line1">Adresse</Label>
                            <Input
                              id="address_line1"
                              value={formState.address_line1}
                              onChange={(event) => setFormState((prev) => ({ ...prev, address_line1: event.target.value }))}
                            />
                          </div>
                          <div className="grid gap-1.5">
                            <Label htmlFor="city">By</Label>
                            <Input
                              id="city"
                              value={formState.city}
                              onChange={(event) => setFormState((prev) => ({ ...prev, city: event.target.value }))}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-2 rounded-lg border border-earth-500/25 bg-paper/60 p-3">
                        <h3 className="text-sm font-semibold text-earth-900">Meen gård</h3>
                        <p className="text-xs text-earth-700">Aktiv: {propertyLabel}</p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div className="grid gap-1.5">
                            <Label htmlFor="label">Navn på gård</Label>
                            <Input
                              id="label"
                              value={formState.label}
                              onChange={(event) => setFormState((prev) => ({ ...prev, label: event.target.value }))}
                            />
                          </div>
                          <div className="grid gap-1.5">
                            <Label htmlFor="komm">Kommunekode</Label>
                            <Input
                              id="komm"
                              value={formState.komm}
                              onChange={(event) => setFormState((prev) => ({ ...prev, komm: event.target.value }))}
                            />
                          </div>
                          <div className="grid gap-1.5">
                            <Label htmlFor="gnr">Gnr</Label>
                            <Input
                              id="gnr"
                              type="number"
                              value={formState.gnr}
                              onChange={(event) => setFormState((prev) => ({ ...prev, gnr: event.target.value }))}
                            />
                          </div>
                          <div className="grid gap-1.5">
                            <Label htmlFor="bnr">Bnr</Label>
                            <Input
                              id="bnr"
                              type="number"
                              value={formState.bnr}
                              onChange={(event) => setFormState((prev) => ({ ...prev, bnr: event.target.value }))}
                            />
                          </div>
                        </div>
                      </div>

                      <DialogFooter>
                        <Button type="submit" disabled={saving}>
                          {saving ? "Lagrer ..." : "Lagre"}
                        </Button>
                      </DialogFooter>
                    </form>
                  </TabsContent>

                  <TabsContent value="layer">
                    <div className="grid gap-4 rounded-lg border border-earth-500/25 bg-paper/60 p-3">
                      <h3 className="text-sm font-semibold text-earth-900">Kartvisning</h3>
                      <div className="grid gap-2">
                        <Label className="text-xs text-earth-700">Bakgrunnskart</Label>
                        <div className="flex flex-wrap gap-2">
                          {BASE_MAP_STYLE_ORDER.map((styleKey) => {
                            const selected = styleKey === baseMapStyle;
                            return (
                              <Button
                                key={styleKey}
                                type="button"
                                size="sm"
                                variant={selected ? "default" : "outline"}
                                className={cn(
                                  "h-8 rounded-full px-3",
                                  selected ? "bg-earth-900 text-white hover:bg-earth-800" : "text-earth-900",
                                )}
                                onClick={() => onChangeBaseMapStyle(styleKey)}
                              >
                                {BASE_MAP_STYLES[styleKey].label}
                              </Button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Switch id="map-vintage" checked={mapVintage} onCheckedChange={onChangeMapVintage} />
                        <Label htmlFor="map-vintage">Vintage-kart (paper look)</Label>
                      </div>

                      <div className="flex items-center gap-2">
                        <Switch id="map-grayscale" checked={mapGrayscale} onCheckedChange={onChangeMapGrayscale} />
                        <Label htmlFor="map-grayscale">Vis kart i svart/hvitt</Label>
                      </div>

                      <div className="grid gap-2 border-t border-earth-500/20 pt-3">
                        <h3 className="text-sm font-semibold text-earth-900">Eiendomslag</h3>
                        <div className="flex items-center gap-2">
                          <Switch id="show-property-layer" checked={showPropertyLayer} onCheckedChange={onTogglePropertyLayer} />
                          <Label htmlFor="show-property-layer">Vis eiendomsgrenser</Label>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <p className="text-xs text-earth-700">{propertyStatus}</p>
                      </div>
                      <p className="text-xs text-earth-700">{statusText}</p>

                      <div className="grid gap-2 border-t border-earth-500/20 pt-3">
                        <h3 className="text-sm font-semibold text-earth-900">Kvalitet</h3>
                        <div className="flex items-center gap-2">
                          <Switch
                            id="show-manual-qc"
                            checked={showOnlyManualQc}
                            onCheckedChange={onToggleManualQcFilter}
                          />
                          <Label htmlFor="show-manual-qc">Vis kun bilder som trenger manuell QC</Label>
                        </div>
                        <div className="flex items-center gap-2">
                          <Switch
                            id="show-low-confidence"
                            checked={showOnlyLowConfidence}
                            onCheckedChange={onToggleLowConfidenceFilter}
                          />
                          <Label htmlFor="show-low-confidence">Vis kun lave tillitsskårer</Label>
                        </div>
                      </div>

                      <div className="grid gap-2 border-t border-earth-500/20 pt-3">
                        <h3 className="text-sm font-semibold text-earth-900">Pro tips</h3>
                        <ul className="space-y-1 text-xs text-earth-700">
                          <li className="flex items-center gap-2">
                            <span className="inline-flex items-center gap-1">
                              <kbd className="fb-kbd">←</kbd>
                              <kbd className="fb-kbd">→</kbd>
                            </span>
                            Neste/forrige bilde i kart og fullskjerm
                          </li>
                          <li className="flex items-center gap-2">
                            <kbd className="fb-kbd">Esc</kbd>
                            Lukk fullskjerm
                          </li>
                          <li className="flex items-center gap-2">
                            <kbd className="fb-kbd">Klikk bilde</kbd>
                            Lukk fullskjerm raskt
                          </li>
                        </ul>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="log">
                    <div className="space-y-2 rounded-lg border border-earth-500/25 bg-paper/60 p-3">
                      <div className="space-y-1">
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="default"
                            size="sm"
                            onClick={onFetchBackendLogs}
                            disabled={backendLogsLoading}
                          >
                            {backendLogsLoading ? "Henter logg ..." : "Hent backendlogg"}
                          </Button>
                          <Button type="button" variant="ghost" size="sm" onClick={onClearBackendLogs}>
                            Tøm backendlogg
                          </Button>
                        </div>
                        <div className="rounded border border-earth-500/25 bg-paper/70 px-2 py-1 text-xs text-earth-700">
                          Viser siste linjer fra backend (begrenset til siste 120 i denne visningen).
                        </div>
                        <ScrollArea className="h-52 rounded-md border border-earth-500/25 bg-paper/75 p-2">
                          {backendLogs.length === 0 ? (
                            <p className="px-2 py-1 text-xs text-earth-700">Ingen serverlogg lastet enda.</p>
                          ) : (
                            <ul className="space-y-1 px-1 py-1 text-xs">
                              {backendLogs.map((entry) => {
                                const requestId = entry.requestId ?? entry.request_id;
                                const key = `${entry.timestamp}-${entry.raw.slice(0, 24)}`;
                                return (
                                  <li key={key} className="rounded border border-earth-500/20 bg-paper px-2 py-1">
                                    <p className="font-mono text-[11px] text-earth-800">
                                      {entry.timestamp} [{entry.level}] {entry.logger}: {entry.message}
                                    </p>
                                    {requestId ? <p className="font-mono text-[10px] text-earth-600">req: {requestId}</p> : null}
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </ScrollArea>
                      </div>

                      <div className="space-y-1">
                        <div className="flex justify-between items-center">
                          <p className="text-xs font-semibold text-earth-900">Teknisk logg (frontend)</p>
                          <Button type="button" variant="ghost" size="sm" onClick={onClearLogs}>
                            Tøm logg
                          </Button>
                        </div>

                        <ScrollArea className="h-40 rounded-md border border-earth-500/25 bg-paper/75 p-2">
                          {logs.length === 0 ? (
                            <p className="px-2 py-1 text-xs text-earth-700">Ingen frontend logger enda.</p>
                          ) : (
                            <ul className="space-y-1 px-1 py-1 text-xs">
                              {logs.map((entry) => (
                                <li key={entry.id} className="rounded border border-earth-500/20 bg-paper px-2 py-1">
                                  <p className="font-mono text-[11px] text-earth-800">
                                    {entry.time} [{entry.level}] {entry.message}
                                  </p>
                                  {entry.requestId ? (
                                    <p className="font-mono text-[10px] text-earth-600">req: {entry.requestId}</p>
                                  ) : null}
                                  {entry.details ? <p className="font-mono text-[10px] text-earth-600">{entry.details}</p> : null}
                                </li>
                              ))}
                            </ul>
                          )}
                        </ScrollArea>
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
              </DialogContent>
              </Dialog>
            </div>
          </div>
        </CardContent>
      </Card>

      <div
        className={cn(
          "pointer-events-auto fixed left-[66px] top-3 z-[850] rounded-full px-3 py-1 text-xs shadow-soft sm:left-[74px]",
          uiTheme === "satellite"
            ? "border border-black/25 bg-black/24 text-[#f4ebdd] backdrop-blur-xl"
            : "border border-earth-500/30 bg-paper/84 text-earth-800",
        )}
      >
        {profile?.property?.label ?? "Meen gård"}
      </div>
    </>
  );
}
