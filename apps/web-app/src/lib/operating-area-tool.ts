import type { GeoPoint, OperatingAreaPreviewResponse, OperatingRelation } from "@/types";

export type OperatingAreaToolPhase = "idle" | "ready" | "loading" | "results" | "empty" | "error" | "confirming" | "success";

export interface OperatingAreaToolState {
  active: boolean;
  phase: OperatingAreaToolPhase;
  requestId: number;
  point: GeoPoint | null;
  preview: OperatingAreaPreviewResponse | null;
  selectedCandidateId: string | null;
  error: string | null;
}

export const initialOperatingAreaToolState: OperatingAreaToolState = {
  active: false,
  phase: "idle",
  requestId: 0,
  point: null,
  preview: null,
  selectedCandidateId: null,
  error: null,
};

export function activateOperatingAreaTool(state: OperatingAreaToolState): OperatingAreaToolState {
  return { ...state, active: true, phase: state.preview ? "results" : "ready", error: null };
}

export function beginOperatingAreaPreview(
  state: OperatingAreaToolState,
  requestId: number,
  point: GeoPoint,
): OperatingAreaToolState {
  return {
    ...state,
    active: true,
    phase: "loading",
    requestId,
    point,
    preview: null,
    selectedCandidateId: null,
    error: null,
  };
}

export function completeOperatingAreaPreview(
  state: OperatingAreaToolState,
  requestId: number,
  preview: OperatingAreaPreviewResponse,
): OperatingAreaToolState {
  if (state.requestId !== requestId) return state;
  const firstCandidateId = preview.candidates.length === 1 ? preview.candidates[0]?.candidate_id ?? null : null;
  return {
    ...state,
    phase: preview.candidates.length > 0 ? "results" : "empty",
    preview,
    selectedCandidateId: firstCandidateId,
    error: null,
  };
}

export function failOperatingAreaPreview(
  state: OperatingAreaToolState,
  requestId: number,
  error: string,
): OperatingAreaToolState {
  if (state.requestId !== requestId) return state;
  return { ...state, phase: "error", preview: null, selectedCandidateId: null, error };
}

export function selectOperatingAreaCandidate(
  state: OperatingAreaToolState,
  candidateId: string,
): OperatingAreaToolState {
  if (!state.preview?.candidates.some((candidate) => candidate.candidate_id === candidateId)) return state;
  return { ...state, selectedCandidateId: candidateId };
}

export function operatingRelationLabel(relation: OperatingRelation): string {
  if (relation === "owned") return "Eid";
  if (relation === "leased") return "Leid";
  return "Ikke angitt";
}

export function canInterruptOperatingAreaTool(phase: OperatingAreaToolPhase): boolean {
  return phase !== "confirming";
}

export function operatingAreaConfirmErrorMessage(status: number | null, fallback: string): string {
  if (status === 401) return "Admininnlogging kreves for å legge til jordet.";
  if (status === 409) return "Teigvalget er endret. Trykk i kartet på nytt.";
  return fallback;
}

export interface OperatingAreaConfirmationGate {
  inFlight: boolean;
  deactivatePending: boolean;
}

export const initialOperatingAreaConfirmationGate: OperatingAreaConfirmationGate = {
  inFlight: false,
  deactivatePending: false,
};

export function beginOperatingAreaConfirmation(
  gate: OperatingAreaConfirmationGate,
): { gate: OperatingAreaConfirmationGate; started: boolean } {
  if (gate.inFlight) return { gate, started: false };
  return { gate: { inFlight: true, deactivatePending: false }, started: true };
}

export function requestOperatingAreaDeactivation(gate: OperatingAreaConfirmationGate): OperatingAreaConfirmationGate {
  return gate.inFlight ? { ...gate, deactivatePending: true } : gate;
}

export function finishOperatingAreaConfirmation(
  gate: OperatingAreaConfirmationGate,
): { gate: OperatingAreaConfirmationGate; shouldDeactivate: boolean } {
  return {
    gate: initialOperatingAreaConfirmationGate,
    shouldDeactivate: gate.deactivatePending,
  };
}
