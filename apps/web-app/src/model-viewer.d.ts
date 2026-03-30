import type * as React from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string;
        alt?: string;
        class?: string;
        className?: string;
        "camera-orbit"?: string;
        "field-of-view"?: string;
        "camera-target"?: string;
        "min-camera-orbit"?: string;
        "max-camera-orbit"?: string;
        "min-field-of-view"?: string;
        "max-field-of-view"?: string;
        "interaction-prompt"?: string;
        "shadow-intensity"?: string;
        "shadow-softness"?: string;
        "environment-image"?: string;
        exposure?: string;
        "interpolation-decay"?: string;
        "touch-action"?: string;
        "camera-controls"?: boolean | "";
        "auto-rotate"?: boolean | "";
        "auto-rotate-delay"?: string;
        "rotation-per-second"?: string;
      };
    }
  }
}

export {};
