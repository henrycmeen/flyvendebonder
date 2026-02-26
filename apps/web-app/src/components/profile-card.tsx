import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Edit3 } from "lucide-react";

import type { ProfileResponse } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Switch } from "@/components/ui/switch";

interface ProfileCardProps {
  profile: ProfileResponse | null;
  propertyStatus: string;
  showPropertyLayer: boolean;
  onTogglePropertyLayer: (next: boolean) => void;
  onSaveProfile: (payload: {
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
  }) => Promise<void>;
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

export function ProfileCard({
  profile,
  propertyStatus,
  showPropertyLayer,
  onTogglePropertyLayer,
  onSaveProfile,
}: ProfileCardProps) {
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
    <Card className="w-full max-w-3xl">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="font-display text-2xl text-fb-text-primary">{profile?.user.full_name ?? "Laster profil..."}</CardTitle>
            <p className="text-sm text-fb-text-secondary">{profile?.property?.label ?? "Meen gård"}</p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Edit3 className="h-3.5 w-3.5" /> Rediger profil
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Rediger profil</DialogTitle>
                <DialogDescription>Oppdater kontaktdata og gårdsnummer for aktiv bruker.</DialogDescription>
              </DialogHeader>
              <form className="grid gap-3" onSubmit={onSubmit}>
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
                    <Label htmlFor="email">E-post</Label>
                    <Input
                      id="email"
                      value={formState.email}
                      onChange={(event) => setFormState((prev) => ({ ...prev, email: event.target.value }))}
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
                    <Label htmlFor="postal_code">Postnummer</Label>
                    <Input
                      id="postal_code"
                      value={formState.postal_code}
                      onChange={(event) => setFormState((prev) => ({ ...prev, postal_code: event.target.value }))}
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
                  <div className="grid gap-1.5">
                    <Label htmlFor="komm">Kommunekode</Label>
                    <Input
                      id="komm"
                      value={formState.komm}
                      onChange={(event) => setFormState((prev) => ({ ...prev, komm: event.target.value }))}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="label">Etikett</Label>
                    <Input
                      id="label"
                      value={formState.label}
                      onChange={(event) => setFormState((prev) => ({ ...prev, label: event.target.value }))}
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
                  <div className="grid gap-1.5">
                    <Label htmlFor="fnr">Fnr</Label>
                    <Input
                      id="fnr"
                      type="number"
                      value={formState.fnr}
                      onChange={(event) => setFormState((prev) => ({ ...prev, fnr: event.target.value }))}
                    />
                  </div>
                </div>

                <DialogFooter>
                  <Button type="submit" disabled={saving}>
                    {saving ? "Lagrer ..." : "Lagre"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm text-fb-text-primary">
        <p>
          <strong>Eiendom:</strong> {propertyLabel}
        </p>
        <p>
          <strong>Adresse:</strong> {profile?.user.address_line1 || "(ikke satt)"}
        </p>
        <p>
          <strong>Telefon:</strong> {profile?.user.phone || "(ikke satt)"}
        </p>
        <p className="text-fb-text-secondary">{propertyStatus}</p>

        <div className="mt-1 flex items-center gap-2">
          <Switch id="show-property-layer" checked={showPropertyLayer} onCheckedChange={onTogglePropertyLayer} />
          <Label htmlFor="show-property-layer">Vis eiendomsgrenser</Label>
        </div>
      </CardContent>
    </Card>
  );
}
