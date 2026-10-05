import "@google/model-viewer";

import type { ProfileResponse } from "@/types";
import { useIsMobile } from "@/hooks/use-is-mobile";

interface PropertyHero3DProps {
  profile: ProfileResponse | null;
  variant?: "profile" | "sidebar" | "menu" | "settings";
}

export function PropertyHero3D({ profile, variant = "profile" }: PropertyHero3DProps) {
  const compactViewport = useIsMobile(1200);
  const settingsOrbit = compactViewport ? "32deg 68deg 80%" : "32deg 68deg 55%";
  const activeProperty = profile?.property ?? null;
  const propertyName = activeProperty?.label?.trim() || "Meen gård";
  const heroUrl = `${import.meta.env.BASE_URL}meen-gard-profile.glb`;
  const isSidebar = variant === "sidebar" || variant === "menu";

  return (
    <div
      className={isSidebar ? "fb-property-hero fb-property-hero--sidebar" : "fb-property-hero"}
      aria-label={`Gårdsobjekt for ${propertyName}`}
    >
      <model-viewer
        src={heroUrl}
        alt={`3D-modell av ${propertyName}`}
        className="fb-property-hero__viewer"
        camera-orbit={isSidebar ? "36deg 68deg 85%" : variant === "settings" ? settingsOrbit : "32deg 68deg 95%"}
        field-of-view={isSidebar ? "22deg" : variant === "settings" ? "12deg" : "24deg"}
        min-camera-orbit={isSidebar ? "36deg 68deg auto" : variant === "settings" ? "auto 45deg 50%" : "auto 45deg 70%"}
        max-camera-orbit={isSidebar ? "36deg 68deg auto" : "auto 88deg 165%"}
        min-field-of-view={isSidebar ? "22deg" : variant === "settings" ? "12deg" : "16deg"}
        max-field-of-view={isSidebar ? "22deg" : "34deg"}
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
