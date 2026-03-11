import { type FormEvent, useEffect, useMemo, useState } from "react";

import { Leaf, Snowflake, Sun, Flower2 } from "lucide-react";

import { TechnicalLogList } from "@/components/technical-log-list";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Divider, Section, Stack } from "@/components/ui/layout-primitives";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BASE_MAP_STYLE_ORDER, BASE_MAP_STYLES, type BaseMapStyle } from "@/lib/map-styles";
import { cn } from "@/lib/utils";
import type { ProfileResponse } from "@/types";

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

interface SettingsDialogProps {
  profile: ProfileResponse | null;
  statusText: string;
  propertyStatus: string;
  showPropertyLayer: boolean;
  showOnlyManualQc: boolean;
  showOnlyLowConfidence: boolean;
  baseMapStyle: BaseMapStyle;
  mapGrayscale: boolean;
  mapVintage: boolean;
  showZoomControls: boolean;
  logs: LogEntry[];
  onClearLogs: () => void;
  backendLogs: BackendLogEntry[];
  backendLogsLoading: boolean;
  onFetchBackendLogs: () => void;
  onClearBackendLogs: () => void;
  onTogglePropertyLayer: (next: boolean) => void;
  onToggleManualQcFilter: (next: boolean) => void;
  onToggleLowConfidenceFilter: (next: boolean) => void;
  onChangeBaseMapStyle: (style: BaseMapStyle) => void;
  onChangeMapGrayscale: (next: boolean) => void;
  onChangeMapVintage: (next: boolean) => void;
  onChangeShowZoomControls: (next: boolean) => void;
  onSaveProfile: (payload: SavePayload) => Promise<void>;
  trigger: React.ReactNode;
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

export function SettingsDialog({
  profile,
  statusText,
  propertyStatus,
  showPropertyLayer,
  showOnlyManualQc,
  showOnlyLowConfidence,
  baseMapStyle,
  mapGrayscale,
  mapVintage,
  showZoomControls,
  logs,
  onClearLogs,
  backendLogs,
  backendLogsLoading,
  onFetchBackendLogs,
  onClearBackendLogs,
  onTogglePropertyLayer,
  onToggleManualQcFilter,
  onToggleLowConfidenceFilter,
  onChangeBaseMapStyle,
  onChangeMapGrayscale,
  onChangeMapVintage,
  onChangeShowZoomControls,
  onSaveProfile,
  trigger,
}: SettingsDialogProps) {
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

  const seasonMeta = useMemo(() => {
    const currentMonth = new Date().getMonth() + 1;
    if (currentMonth >= 3 && currentMonth <= 5) return { label: "Vår", Icon: Flower2 };
    if (currentMonth >= 6 && currentMonth <= 8) return { label: "Sommer", Icon: Sun };
    if (currentMonth >= 9 && currentMonth <= 11) return { label: "Høst", Icon: Leaf };
    return { label: "Vinter", Icon: Snowflake };
  }, []);

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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-[28px] border-fb-border-subtle bg-[#f7f4ea] p-5 shadow-[0_28px_80px_rgba(35,48,56,0.24)] sm:max-w-[980px] sm:p-6">
        <DialogHeader>
          <DialogTitle>Innstillinger</DialogTitle>
          <DialogDescription>Profil, kartlag og teknisk logg for Flyvendebønder.</DialogDescription>
        </DialogHeader>

        <div className="rounded-[22px] border border-[#d9d3bf] bg-[#fffdf7] px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-fb-text-muted">Aktiv gård</p>
              <p className="text-base font-semibold text-fb-text-primary">{profile?.property?.label ?? "Meen gård"}</p>
              <p className="text-xs text-fb-text-secondary">{propertyLabel}</p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[#ddd6c3] bg-[#fcfaf3] px-3 py-1.5 text-xs text-fb-text-secondary">
              <seasonMeta.Icon className="h-3.5 w-3.5" />
              {seasonMeta.label}
            </div>
          </div>
        </div>

        <Tabs defaultValue="profile" className="w-full">
          <TabsList className="grid h-auto w-full grid-cols-3 gap-2 rounded-none border-0 bg-transparent p-0">
            <TabsTrigger value="profile" className="rounded-[18px] border border-[#d9d3bf] bg-[#f3eee2] py-3 data-[state=active]:border-[#b7af95] data-[state=active]:bg-[#fffdf7]">Profil</TabsTrigger>
            <TabsTrigger value="layer" className="rounded-[18px] border border-[#d9d3bf] bg-[#f3eee2] py-3 data-[state=active]:border-[#b7af95] data-[state=active]:bg-[#fffdf7]">Kartlag</TabsTrigger>
            <TabsTrigger value="log" className="rounded-[18px] border border-[#d9d3bf] bg-[#f3eee2] py-3 data-[state=active]:border-[#b7af95] data-[state=active]:bg-[#fffdf7]">Teknisk logg</TabsTrigger>
          </TabsList>

          <TabsContent value="profile" className="mt-4">
            <form className="w-full" onSubmit={onSubmit}>
              <Stack gap={4}>
                <Section compact title="Kundeprofil" className="rounded-[22px] border-[#d9d3bf] bg-[#fffdf7] shadow-none">
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
                      <Input id="phone" value={formState.phone} onChange={(event) => setFormState((prev) => ({ ...prev, phone: event.target.value }))} />
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
                      <Input id="city" value={formState.city} onChange={(event) => setFormState((prev) => ({ ...prev, city: event.target.value }))} />
                    </div>
                  </div>
                </Section>

                <Section compact title="Eiendom" description={`Aktiv: ${propertyLabel}`} className="rounded-[22px] border-[#d9d3bf] bg-[#fffdf7] shadow-none">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="grid gap-1.5">
                      <Label htmlFor="label">Navn på gård</Label>
                      <Input id="label" value={formState.label} onChange={(event) => setFormState((prev) => ({ ...prev, label: event.target.value }))} />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="komm">Kommunekode</Label>
                      <Input id="komm" value={formState.komm} onChange={(event) => setFormState((prev) => ({ ...prev, komm: event.target.value }))} />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="gnr">Gnr</Label>
                      <Input id="gnr" type="number" value={formState.gnr} onChange={(event) => setFormState((prev) => ({ ...prev, gnr: event.target.value }))} />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="bnr">Bnr</Label>
                      <Input id="bnr" type="number" value={formState.bnr} onChange={(event) => setFormState((prev) => ({ ...prev, bnr: event.target.value }))} />
                    </div>
                  </div>
                </Section>

                <DialogFooter>
                  <Button type="submit" disabled={saving}>
                    {saving ? "Lagrer ..." : "Lagre"}
                  </Button>
                </DialogFooter>
              </Stack>
            </form>
          </TabsContent>

          <TabsContent value="layer" className="mt-4">
            <Stack gap={4} className="rounded-[22px] border border-[#d9d3bf] bg-[#fffdf7] p-4 shadow-none">
              <div className="grid gap-2">
                <Label className="text-xs uppercase tracking-[0.08em] text-fb-text-secondary">Bakgrunnskart</Label>
                <div className="flex flex-wrap gap-2">
                  {BASE_MAP_STYLE_ORDER.map((styleKey) => {
                    const selected = styleKey === baseMapStyle;
                    return (
                      <Button
                        key={styleKey}
                        type="button"
                        size="sm"
                        variant={selected ? "default" : "outline"}
                        className={cn("h-8 rounded-full px-3", selected ? "bg-[color:var(--fb-chip-active-bg)] text-[color:var(--fb-chip-active-text)]" : "text-fb-text-primary")}
                        onClick={() => onChangeBaseMapStyle(styleKey)}
                      >
                        {BASE_MAP_STYLES[styleKey].label}
                      </Button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-[18px] border border-[#e0dbc9] bg-[#fcfaf3] px-3 py-3">
                <div>
                  <p className="text-sm text-fb-text-primary">Vintage-kart</p>
                  <p className="text-xs text-fb-text-secondary">Papiraktig bakgrunn for roligere kartvisning.</p>
                </div>
                <Switch id="map-vintage" checked={mapVintage} onCheckedChange={onChangeMapVintage} />
              </div>

              <div className="flex items-center justify-between gap-3 rounded-[18px] border border-[#e0dbc9] bg-[#fcfaf3] px-3 py-3">
                <div>
                  <p className="text-sm text-fb-text-primary">Svart/hvitt</p>
                  <p className="text-xs text-fb-text-secondary">Demper bakgrunnskartet når bildene skal være i fokus.</p>
                </div>
                <Switch id="map-grayscale" checked={mapGrayscale} onCheckedChange={onChangeMapGrayscale} />
              </div>

              <div className="flex items-center justify-between gap-3 rounded-[18px] border border-[#e0dbc9] bg-[#fcfaf3] px-3 py-3">
                <div>
                  <p className="text-sm text-fb-text-primary">Vis zoomknapper</p>
                  <p className="text-xs text-fb-text-secondary">Vis pluss/minus-knappene i kartet.</p>
                </div>
                <Switch id="map-zoom-controls" checked={showZoomControls} onCheckedChange={onChangeShowZoomControls} />
              </div>

              <Divider />

              <div className="flex items-center justify-between gap-3 rounded-[18px] border border-[#e0dbc9] bg-[#fcfaf3] px-3 py-3">
                <div>
                  <p className="text-sm text-fb-text-primary">Vis eiendomsgrenser</p>
                  <p className="text-xs text-fb-text-secondary">{propertyStatus}</p>
                </div>
                <Switch id="show-property-layer" checked={showPropertyLayer} onCheckedChange={onTogglePropertyLayer} />
              </div>

              <div className="flex items-center justify-between gap-3 rounded-[18px] border border-[#e0dbc9] bg-[#fcfaf3] px-3 py-3">
                <div>
                  <p className="text-sm text-fb-text-primary">Kun manuell QC</p>
                  <p className="text-xs text-fb-text-secondary">Vis bare bilder som trenger manuell vurdering.</p>
                </div>
                <Switch id="show-manual-qc" checked={showOnlyManualQc} onCheckedChange={onToggleManualQcFilter} />
              </div>

              <div className="flex items-center justify-between gap-3 rounded-[18px] border border-[#e0dbc9] bg-[#fcfaf3] px-3 py-3">
                <div>
                  <p className="text-sm text-fb-text-primary">Lav tillit</p>
                  <p className="text-xs text-fb-text-secondary">Sorter frem bilder med svakest posisjon først.</p>
                </div>
                <Switch id="show-low-confidence" checked={showOnlyLowConfidence} onCheckedChange={onToggleLowConfidenceFilter} />
              </div>

              <div className="rounded-[18px] border border-[#e0dbc9] bg-[#fcfaf3] px-3 py-2 text-xs text-fb-text-secondary">
                {statusText}
              </div>
            </Stack>
          </TabsContent>

          <TabsContent value="log" className="mt-4">
            <Stack gap={3} className="rounded-[22px] border border-[#d9d3bf] bg-[#fffdf7] p-4 shadow-none">
              <div className="space-y-2">
                <div className="flex flex-wrap justify-end gap-2">
                  <Button type="button" variant="default" size="sm" onClick={onFetchBackendLogs} disabled={backendLogsLoading}>
                    {backendLogsLoading ? "Henter logg ..." : "Hent backendlogg"}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={onClearBackendLogs}>
                    Tøm backendlogg
                  </Button>
                </div>
                <div className="rounded-[18px] border border-[#e0dbc9] bg-[#fcfaf3] px-3 py-2 text-xs text-fb-text-secondary">
                  Viser siste linjer fra backend, begrenset til siste 120 i denne visningen.
                </div>
                <ScrollArea className="h-52 rounded-[18px] border border-[#e0dbc9] bg-[#fcfaf3] p-2">
                  <TechnicalLogList
                    emptyText="Ingen serverlogg lastet enda."
                    items={backendLogs.map((entry) => ({
                      id: `${entry.timestamp}-${entry.raw.slice(0, 24)}`,
                      main: `${entry.timestamp} [${entry.level}] ${entry.logger}: ${entry.message}`,
                      requestId: entry.requestId ?? entry.request_id,
                    }))}
                  />
                </ScrollArea>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-fb-text-muted">Frontendlogg</p>
                  <Button type="button" variant="ghost" size="sm" onClick={onClearLogs}>
                    Tøm logg
                  </Button>
                </div>
                <ScrollArea className="h-40 rounded-[18px] border border-[#e0dbc9] bg-[#fcfaf3] p-2">
                  <TechnicalLogList
                    emptyText="Ingen frontend logger enda."
                    items={logs.map((entry) => ({
                      id: entry.id,
                      main: `${entry.time} [${entry.level}] ${entry.message}`,
                      requestId: entry.requestId,
                      details: entry.details,
                    }))}
                  />
                </ScrollArea>
              </div>
            </Stack>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
