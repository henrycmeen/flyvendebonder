export const motionDuration = {
  micro: 100,
  small: 160,
  medium: 240,
  large: 360,
} as const;

export const motionEasing = {
  standard: "cubic-bezier(0.2, 0.8, 0.2, 1)",
  accelerate: "cubic-bezier(0.4, 0, 1, 1)",
  decelerate: "cubic-bezier(0, 0, 0.2, 1)",
} as const;

export type InteractiveMotionState =
  | "idle"
  | "hover"
  | "focus-visible"
  | "pressed"
  | "disabled"
  | "loading"
  | "success"
  | "error";

export const interactiveStateSequence: readonly InteractiveMotionState[] = [
  "idle",
  "hover",
  "pressed",
  "loading",
  "success",
  "error",
];
