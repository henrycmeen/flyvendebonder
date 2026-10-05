import "@google/model-viewer";

import type { ProfileResponse } from "@/types";

interface PropertyHero3DProps {
  profile: ProfileResponse | null;
  variant?: "profile" | "sidebar" | "menu";
}

export function PropertyHero3D({ profile, variant = "profile" }: PropertyHero3DProps) {
  const activeProperty = profile?.property ?? null;
  const propertyName = activeProperty?.label?.trim() || "Meen gård";
  const heroUrl = `${import.meta.env.BASE_URL}meen-gard-profile.glb`;
  const isSidebar = variant !== "profile";

  return (
    <div
      className={isSidebar ? "fb-property-hero fb-property-hero--sidebar" : "fb-property-hero"}
      aria-label={`Gårdsobjekt for ${propertyName}`}
    >
      <model-viewer
        src={heroUrl}
        alt={`3D-modell av ${propertyName}`}
        className="fb-property-hero__viewer"
        camera-orbit={isSidebar ? "36deg 68deg 48%" : "32deg 68deg 95%"}
        field-of-view={isSidebar ? "19deg" : "24deg"}
        min-camera-orbit={isSidebar ? "36deg 68deg auto" : "auto 45deg 70%"}
        max-camera-orbit={isSidebar ? "36deg 68deg auto" : "auto 88deg 165%"}
        min-field-of-view={isSidebar ? "19deg" : "16deg"}
        max-field-of-view={isSidebar ? "19deg" : "34deg"}
        camera-target={isSidebar ? "0m 0m 0m" : undefined}
        interpolation-decay="120"
        shadow-intensity="1"
        shadow-softness="0.8"
        exposure="1.02"
        environment-image="neutral"
        interaction-prompt="none"
        {...(variant === "sidebar" ? { "auto-rotate": "", "rotation-per-second": "0.8deg", "auto-rotate-delay": "0" } : {})}
        {...(isSidebar ? {} : { "camera-controls": "", "touch-action": "pan-y" })}
      />
    </div>
  );
}
