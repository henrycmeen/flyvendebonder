import { useCallback, useEffect, useState } from "react";
import { useSidebarVisibility } from "@/components/ui/sidebar-visibility";

let modelViewerImport: Promise<unknown> | undefined;
function loadModelViewer() {
  return modelViewerImport ??= Promise.resolve().then(async () => {
    // The installed model-viewer renderer requires WebGL 2. Probe once on demand,
    // before importing it or requesting a model; a load event alone is not render evidence.
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2", {alpha: true, antialias: true, preserveDrawingBuffer: true});
    if (!context) throw new Error("WebGL 2 context could not be created");
    try {
      if (context.isContextLost()) throw new Error("WebGL 2 context is unavailable");
    } finally {
      context.getExtension("WEBGL_lose_context")?.loseContext();
    }
    await import("@google/model-viewer");
    await customElements.whenDefined("model-viewer");
  });
}

import type { ProfileResponse } from "@/types";
import { useIsMobile } from "@/hooks/use-is-mobile";

interface PropertyHero3DProps {
  profile: ProfileResponse | null;
  variant?: "profile" | "sidebar" | "menu" | "settings";
}

function HeroPlaceholder({message}: {message: string}) {
  return <div className="absolute inset-0 flex flex-col items-center justify-center">
    <img src={`${import.meta.env.BASE_URL}farmstead-placeholder-3d.svg`} alt="Illustrert plassholder for et gårdstun" className="h-full w-full object-contain" />
    <span className="absolute bottom-0 text-center text-[10px] text-fb-text-muted" role="status">Illustrasjon · {message}</span>
  </div>;
}

function PropertyModelViewer({variant, settingsOrbit, propertyName, heroUrl}: {variant: NonNullable<PropertyHero3DProps["variant"]>; settingsOrbit: string; propertyName: string; heroUrl: string}) {
  const isSidebar = variant === "sidebar" || variant === "menu";
  const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading");
  const attachViewer = useCallback((viewer: HTMLElement | null) => {
    if (!viewer) return;
    const loaded = () => setPhase("ready");
    const failed = () => setPhase("failed");
    viewer.addEventListener("load", loaded);
    viewer.addEventListener("error", failed);
    viewer.addEventListener("webglcontextlost", failed);
    if ((viewer as HTMLElement & {loaded?: boolean}).loaded) loaded();
    return () => {
      viewer.removeEventListener("load", loaded);
      viewer.removeEventListener("error", failed);
      viewer.removeEventListener("webglcontextlost", failed);
    };
  }, []);
  return <>
    {phase !== "failed" && <model-viewer
        ref={attachViewer}
        src={heroUrl}
        alt={`3D-modell av ${propertyName}`}
        className="fb-property-hero__viewer"
        style={{opacity: phase === "ready" ? 1 : 0}}
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
      />}
    {phase !== "ready" && <HeroPlaceholder message={phase === "failed" ? "3D kunne ikke lastes" : "3D lastes …"} />}
  </>;
}

export function PropertyHero3D({ profile, variant = "profile" }: PropertyHero3DProps) {
  const compactViewport = useIsMobile(1200);
  const settingsOrbit = compactViewport ? "32deg 68deg 80%" : "32deg 68deg 55%";
  const activeProperty = profile?.property ?? null;
  const propertyName = activeProperty?.label?.trim() || "Meen gård";
  const heroUrl = `${import.meta.env.BASE_URL}meen-gard-profile.glb`;
  const isSidebar = variant === "sidebar" || variant === "menu";

  const sidebarVisible = useSidebarVisibility();
  const visible = !isSidebar || sidebarVisible;
  const [library, setLibrary] = useState<"idle" | "ready" | "failed">("idle");
  useEffect(() => {
    if (!visible || library !== "idle") return;
    let active = true;
    loadModelViewer().then(() => { if (active) setLibrary("ready"); })
      .catch(() => { if (active) setLibrary("failed"); });
    return () => { active = false; };
  }, [visible, library]);

  return (
    <div
      className={isSidebar ? "fb-property-hero fb-property-hero--sidebar relative" : "fb-property-hero relative"}
      aria-label={`Gårdsvisning for ${propertyName}`}
    >
      {visible && library === "ready"
        ? <PropertyModelViewer variant={variant} settingsOrbit={settingsOrbit} propertyName={propertyName} heroUrl={heroUrl} />
        : <HeroPlaceholder message={library === "failed" ? "3D kunne ikke lastes" : visible ? "3D lastes …" : "plassholder"} />}
    </div>
  );
}
