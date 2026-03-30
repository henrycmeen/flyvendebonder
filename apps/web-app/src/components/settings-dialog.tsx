import { type FormEvent, useEffect, useMemo, useState } from "react";

import { Plus, Trash2 } from "lucide-react";

import { TechnicalLogList } from "@/components/technical-log-list";
import { PropertyHero3D } from "@/components/property-hero-3d";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Divider, Section, Stack } from "@/components/ui/layout-primitives";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BASE_MAP_STYLE_ORDER, BASE_MAP_STYLES, type BaseMapStyle } from "@/lib/map-styles";
import { cn } from "@/lib/utils";
import type { AdminSessionStatus, ProfileResponse } from "@/types";

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

interface SettingsDialogProps {
  profile: ProfileResponse | null;
  adminStatus: AdminSessionStatus | null;
  adminBusy: boolean;
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
  onSaveProfile: (payload: SavePayload) => Promise<void>;
  onAdminLogin: (code: string) => Promise<void>;
  onAdminLogout: () => Promise<void>;
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

interface AdditionalPropertyDraft {
  client_id: string;
  id?: number;
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

function createDraftId() {
  return `draft-${Math.random().toString(36).slice(2, 10)}`;
}

function emptyAdditionalPropertyDraft(): AdditionalPropertyDraft {
  return {
    client_id: createDraftId(),
    komm: "",
    gnr: "",
    bnr: "",
    fnr: "",
    label: "",
  };
}

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

function toAdditionalPropertyDrafts(profile: ProfileResponse | null): AdditionalPropertyDraft[] {
  return (profile?.additional_properties ?? []).map((property) => ({
    client_id: `property-${property.id}`,
    id: property.id,
    komm: property.komm,
    gnr: String(property.gnr),
    bnr: String(property.bnr),
    fnr: property.fnr ? String(property.fnr) : "",
    label: property.label ?? "",
  }));
}

function toNumberOrUndefined(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function hasAnyAdditionalPropertyValue(draft: AdditionalPropertyDraft): boolean {
  return [draft.label, draft.komm, draft.gnr, draft.bnr, draft.fnr].some((value) => value.trim().length > 0);
}

export function SettingsDialog({
  profile,
  adminStatus,
  adminBusy,
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
  onSaveProfile,
  onAdminLogin,
  onAdminLogout,
  trigger,
}: SettingsDialogProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formState, setFormState] = useState<FormState>(toFormState(profile));
  const [additionalProperties, setAdditionalProperties] = useState<AdditionalPropertyDraft[]>(toAdditionalPropertyDrafts(profile));
  const [adminCode, setAdminCode] = useState("");
  const [adminError, setAdminError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setFormState(toFormState(profile));
    setAdditionalProperties(toAdditionalPropertyDrafts(profile));
    setSaveError(null);
  }, [profile]);

  useEffect(() => {
    if (!adminStatus?.authenticated) {
      return;
    }
    setAdminCode("");
    setAdminError(null);
  }, [adminStatus?.authenticated]);

  useEffect(() => {
    if (open) return;
    setSaveError(null);
  }, [open]);

  const propertyLabel = useMemo(() => {
    if (!profile?.property) return "Ingen aktiv eiendom";
    return `${profile.property.komm}-${profile.property.gnr}/${profile.property.bnr}/${profile.property.fnr}`;
  }, [profile]);
  const activePropertyName = useMemo(() => profile?.property?.label?.trim() || "Ingen aktiv eiendom", [profile]);

  const adminExpiryLabel = useMemo(() => {
    if (!adminStatus?.expires_at) return null;
    const parsed = new Date(adminStatus.expires_at);
    if (Number.isNaN(parsed.getTime())) return null;
    return new Intl.DateTimeFormat("nb-NO", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(parsed);
  }, [adminStatus?.expires_at]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!adminStatus?.authenticated) {
      return;
    }
    setSaveError(null);

    const normalizedAdditionalProperties: SavePayload["additional_properties"] = [];
    for (const [index, propertyDraft] of additionalProperties.entries()) {
      if (!hasAnyAdditionalPropertyValue(propertyDraft)) continue;

      const komm = propertyDraft.komm.trim();
      const gnr = toNumberOrUndefined(propertyDraft.gnr);
      const bnr = toNumberOrUndefined(propertyDraft.bnr);
      const fnr = toNumberOrUndefined(propertyDraft.fnr) ?? 0;
      const label = propertyDraft.label.trim();

      if (!komm || gnr == null || bnr == null) {
        setSaveError(`Ekstra eiendom ${index + 1} må ha kommunekode, gnr og bnr.`);
        return;
      }

      normalizedAdditionalProperties.push({
        id: propertyDraft.id,
        komm,
        gnr,
        bnr,
        fnr,
        label: label || undefined,
      });
    }

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
        additional_properties: normalizedAdditionalProperties,
      });
      setOpen(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Kunne ikke lagre innstillinger.");
    } finally {
      setSaving(false);
    }
  };

  const handleAdminLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedCode = adminCode.trim();
    if (!trimmedCode) {
      setAdminError("Skriv inn admin-koden.");
      return;
    }

    setAdminError(null);
    try {
      await onAdminLogin(trimmedCode);
      setAdminCode("");
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : "Kunne ikke aktivere admin.");
    }
  };

  const handleAdminLogout = async () => {
    setAdminError(null);
    try {
      await onAdminLogout();
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : "Kunne ikke logge ut admin.");
    }
  };

  const addAdditionalPropertyRow = () => {
    setAdditionalProperties((previous) => [...previous, emptyAdditionalPropertyDraft()]);
  };

  const removeAdditionalPropertyRow = (clientId: string) => {
    setAdditionalProperties((previous) => previous.filter((property) => property.client_id !== clientId));
  };

  const updateAdditionalPropertyRow = (
    clientId: string,
    field: keyof Omit<AdditionalPropertyDraft, "client_id" | "id">,
    value: string,
  ) => {
    setAdditionalProperties((previous) =>
      previous.map((property) => (property.client_id === clientId ? { ...property, [field]: value } : property)),
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[90vh] gap-3 overflow-y-auto rounded-[28px] border-fb-border-subtle bg-[#f7f4ea] p-5 shadow-[0_28px_80px_rgba(35,48,56,0.24)] sm:max-w-[980px] sm:p-6"
      >
        <DialogHeader className="space-y-0">
          <DialogTitle>Innstillinger</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="profile" className="w-full">
          <TabsList className="grid h-auto w-full grid-cols-3 gap-2 rounded-none border-0 bg-transparent p-0">
            <TabsTrigger value="profile" className="rounded-[18px] border border-[#d9d3bf] bg-[#f3eee2] py-3 data-[state=active]:border-[#b7af95] data-[state=active]:bg-[#fffdf7]">Profil</TabsTrigger>
            <TabsTrigger value="layer" className="rounded-[18px] border border-[#d9d3bf] bg-[#f3eee2] py-3 data-[state=active]:border-[#b7af95] data-[state=active]:bg-[#fffdf7]">Kartlag</TabsTrigger>
            <TabsTrigger value="admin" className="rounded-[18px] border border-[#d9d3bf] bg-[#f3eee2] py-3 data-[state=active]:border-[#b7af95] data-[state=active]:bg-[#fffdf7]">Admin</TabsTrigger>
          </TabsList>

          <TabsContent value="profile" className="mt-3">
            <form className="w-full" onSubmit={onSubmit}>
              <Stack gap={4}>
                {!adminStatus?.authenticated ? (
                  <div className="rounded-[18px] border border-[#e0dbc9] bg-[#fcfaf3] px-3 py-2 text-xs text-fb-text-secondary">
                    Profilendringer krever admin-innlogging under fanen Admin.
                  </div>
                ) : null}
                {saveError ? (
                  <div className="rounded-[18px] border border-[color:var(--fb-accent-danger)]/30 bg-[color:var(--fb-accent-danger)]/8 px-3 py-2 text-xs text-fb-text-primary">
                    {saveError}
                  </div>
                ) : null}
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

                <Section
                  compact
                  title="Eiendom"
                  actions={
                    <Button type="button" variant="outline" size="sm" className="h-8 rounded-full px-3" onClick={addAdditionalPropertyRow}>
                      <Plus className="h-3.5 w-3.5" />
                      Legg til eiendom
                    </Button>
                  }
                  className="rounded-[22px] border-[#d9d3bf] bg-[#fffdf7] shadow-none"
                >
                  <div className="space-y-3">
                    <div className="flex items-center gap-8 rounded-[18px] border border-[#e0dbc9] bg-[#fcfaf3] px-5 py-4">
                      <div className="min-w-0 w-[220px] shrink-0">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fb-text-muted">Aktiv gård</p>
                        <p className="mt-1 text-base font-semibold text-fb-text-primary">{activePropertyName}</p>
                        <p className="text-xs text-fb-text-secondary">{propertyLabel}</p>
                      </div>
                      <div className="shrink-0">
                        <PropertyHero3D profile={profile} />
                      </div>
                    </div>

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
                    <div className="grid gap-1.5">
                      <Label htmlFor="fnr">Fnr</Label>
                      <Input id="fnr" type="number" value={formState.fnr} onChange={(event) => setFormState((prev) => ({ ...prev, fnr: event.target.value }))} />
                    </div>
                  </div>

                    <Divider />

                    <div className="space-y-3">
                      <div>
                        <p className="text-sm font-semibold text-fb-text-primary">Ekstra eiendommer</p>
                        <p className="text-xs text-fb-text-secondary">Legg til leiejord eller andre teiger som skal ligge ved siden av aktiv eiendom.</p>
                      </div>

                      {additionalProperties.length ? (
                        <Stack gap={3}>
                          {additionalProperties.map((property, index) => (
                            <div key={property.client_id} className="rounded-[18px] border border-[#e0dbc9] bg-[#fcfaf3] p-3">
                              <div className="mb-3 flex items-center justify-between gap-3">
                                <div>
                                  <p className="text-sm font-medium text-fb-text-primary">Ekstra eiendom {index + 1}</p>
                                  <p className="text-xs text-fb-text-secondary">Brukes for tilleggsteiger og leiejord.</p>
                                </div>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 rounded-full text-fb-text-secondary"
                                  onClick={() => removeAdditionalPropertyRow(property.client_id)}
                                  aria-label={`Fjern ekstra eiendom ${index + 1}`}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>

                              <div className="grid gap-2 sm:grid-cols-2">
                                <div className="grid gap-1.5">
                                  <Label htmlFor={`additional-label-${property.client_id}`}>Navn</Label>
                                  <Input
                                    id={`additional-label-${property.client_id}`}
                                    value={property.label}
                                    onChange={(event) => updateAdditionalPropertyRow(property.client_id, "label", event.target.value)}
                                  />
                                </div>
                                <div className="grid gap-1.5">
                                  <Label htmlFor={`additional-komm-${property.client_id}`}>Kommunekode</Label>
                                  <Input
                                    id={`additional-komm-${property.client_id}`}
                                    value={property.komm}
                                    onChange={(event) => updateAdditionalPropertyRow(property.client_id, "komm", event.target.value)}
                                  />
                                </div>
                                <div className="grid gap-1.5">
                                  <Label htmlFor={`additional-gnr-${property.client_id}`}>Gnr</Label>
                                  <Input
                                    id={`additional-gnr-${property.client_id}`}
                                    type="number"
                                    value={property.gnr}
                                    onChange={(event) => updateAdditionalPropertyRow(property.client_id, "gnr", event.target.value)}
                                  />
                                </div>
                                <div className="grid gap-1.5">
                                  <Label htmlFor={`additional-bnr-${property.client_id}`}>Bnr</Label>
                                  <Input
                                    id={`additional-bnr-${property.client_id}`}
                                    type="number"
                                    value={property.bnr}
                                    onChange={(event) => updateAdditionalPropertyRow(property.client_id, "bnr", event.target.value)}
                                  />
                                </div>
                                <div className="grid gap-1.5 sm:max-w-[12rem]">
                                  <Label htmlFor={`additional-fnr-${property.client_id}`}>Fnr</Label>
                                  <Input
                                    id={`additional-fnr-${property.client_id}`}
                                    type="number"
                                    value={property.fnr}
                                    onChange={(event) => updateAdditionalPropertyRow(property.client_id, "fnr", event.target.value)}
                                  />
                                </div>
                              </div>
                            </div>
                          ))}
                        </Stack>
                      ) : (
                        <div className="rounded-[18px] border border-dashed border-[#d6cfbb] bg-[#fcfaf3] px-3 py-3 text-sm text-fb-text-secondary">
                          Ingen ekstra eiendommer lagt til ennå.
                        </div>
                      )}
                    </div>
                  </div>
                </Section>

                <DialogFooter>
                  <Button type="submit" disabled={saving || !adminStatus?.authenticated}>
                    {saving ? "Lagrer ..." : adminStatus?.authenticated ? "Lagre" : "Admin kreves"}
                  </Button>
                </DialogFooter>
              </Stack>
            </form>
          </TabsContent>

          <TabsContent value="layer" className="mt-3">
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
                  <p className="text-sm text-fb-text-primary">Vis jordsmonn</p>
                  <p className="text-xs text-fb-text-secondary">{soilStatus}</p>
                </div>
                <Switch id="show-soil-layer" checked={showSoilLayer} onCheckedChange={onToggleSoilLayer} />
              </div>

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

          <TabsContent value="admin" className="mt-3">
            <Stack gap={4} className="rounded-[22px] border border-[#d9d3bf] bg-[#fffdf7] p-4 shadow-none">
              <div className="rounded-[18px] border border-[#e0dbc9] bg-[#fcfaf3] px-3 py-3 text-sm text-fb-text-primary">
                {adminStatus === null
                  ? "Sjekker admin-status ..."
                  : !adminStatus.configured
                    ? "Admin-kode er ikke konfigurert i backend ennå. Sett ADMIN_ACCESS_CODE før skriveoperasjoner åpnes."
                    : adminStatus.authenticated
                      ? `Admin er aktiv${adminExpiryLabel ? ` til ${adminExpiryLabel}` : ""}. Import og andre skriveoperasjoner er åpnet.`
                      : "Logg inn med admin-kode for å åpne import og andre skriveoperasjoner."}
              </div>

              {adminStatus?.configured ? (
                adminStatus.authenticated ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-[#e0dbc9] bg-[#fcfaf3] px-3 py-3">
                    <div>
                      <p className="text-sm font-medium text-fb-text-primary">Admin aktiv</p>
                      <p className="text-xs text-fb-text-secondary">
                        {adminExpiryLabel ? `Sesjonen utløper ${adminExpiryLabel}.` : "Sesjonen er aktiv i nettleseren din."}
                      </p>
                    </div>
                    <Button type="button" variant="outline" onClick={() => void handleAdminLogout()} disabled={adminBusy}>
                      {adminBusy ? "Logger ut ..." : "Logg ut admin"}
                    </Button>
                  </div>
                ) : (
                  <form className="space-y-3" onSubmit={handleAdminLogin}>
                    <div className="grid gap-1.5">
                      <Label htmlFor="admin-code">Admin-kode</Label>
                      <Input
                        id="admin-code"
                        type="password"
                        value={adminCode}
                        onChange={(event) => setAdminCode(event.target.value)}
                        placeholder="Skriv inn kode"
                        autoComplete="current-password"
                        disabled={adminBusy}
                      />
                    </div>
                    {adminError ? (
                      <div className="rounded-[18px] border border-[color:var(--fb-accent-danger)]/30 bg-[color:var(--fb-accent-danger)]/8 px-3 py-2 text-xs text-fb-text-primary">
                        {adminError}
                      </div>
                    ) : null}
                    <div className="flex justify-end">
                      <Button type="submit" disabled={adminBusy || !adminCode.trim()}>
                        {adminBusy ? "Logger inn ..." : "Aktiver admin"}
                      </Button>
                    </div>
                  </form>
                )
              ) : null}

              {adminStatus?.authenticated ? (
                <Stack gap={3} className="rounded-[22px] border border-[#d9d3bf] bg-[#fffdf7] p-4 shadow-none">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-fb-text-muted">Teknisk logg</p>
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button type="button" variant="default" size="sm" onClick={onFetchBackendLogs} disabled={backendLogsLoading}>
                          {backendLogsLoading ? "Henter logg ..." : "Hent backendlogg"}
                        </Button>
                        <Button type="button" variant="ghost" size="sm" onClick={onClearBackendLogs}>
                          Tøm backendlogg
                        </Button>
                      </div>
                    </div>
                    <div className="rounded-[18px] border border-[#e0dbc9] bg-[#fcfaf3] px-3 py-2 text-xs text-fb-text-secondary">
                      Viser siste linjer fra backend, begrenset til siste 120 i denne visningen.
                    </div>
                    <ScrollArea className="h-52 rounded-[18px] border border-[#e0dbc9] bg-[#fcfaf3] p-2">
                      <TechnicalLogList
                        emptyText="Ingen serverlogg lastet enda."
                        items={backendLogs.map((entry, index) => ({
                          id: `${entry.timestamp}-${entry.requestId ?? entry.request_id ?? entry.logger}-${index}`,
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
              ) : (
                <div className="rounded-[18px] border border-[#e0dbc9] bg-[#fcfaf3] px-3 py-3 text-sm text-fb-text-secondary">
                  Teknisk logg låses opp når admin er aktiv.
                </div>
              )}
            </Stack>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
