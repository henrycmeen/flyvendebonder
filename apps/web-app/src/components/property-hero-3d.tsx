import type { ProfileResponse } from "@/types";

interface PropertyHero3DProps {
  profile: ProfileResponse | null;
}

export function PropertyHero3D({ profile }: PropertyHero3DProps) {
  const activeProperty = profile?.property ?? null;
  const propertyName = activeProperty?.label?.trim() || "Meen gård";
  const propertyReference = activeProperty
    ? `${activeProperty.gnr}/${activeProperty.bnr}${activeProperty.fnr ? `/${activeProperty.fnr}` : ""}`
    : "Hovedgård";
  const municipality = profile?.user?.municipality_name?.trim() || "Skien";
  const heroUrl = `${import.meta.env.BASE_URL}farmstead-placeholder-3d.svg`;

  return (
    <section className="fb-property-hero" aria-label={`Gårdsmodell for ${propertyName}`}>
      <div className="fb-property-hero__visual">
        <img src={heroUrl} alt="" className="fb-property-hero__image" />
      </div>
      <div className="fb-property-hero__copy">
        <p className="fb-property-hero__eyebrow">Gårdsmodell</p>
        <h2 className="fb-property-hero__title">{propertyName}</h2>
        <p className="fb-property-hero__meta">
          {propertyReference} · {municipality}
        </p>
        <p className="fb-property-hero__note">Midlertidig 3D-objekt til ekte gårdsmodell er klar.</p>
      </div>
    </section>
  );
}
