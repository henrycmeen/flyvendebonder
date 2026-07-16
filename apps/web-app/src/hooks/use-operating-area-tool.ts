import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { apiPost, apiPut, ApiError } from "@/lib/api";
import {
  activateOperatingAreaTool,
  beginOperatingAreaConfirmation,
  beginOperatingAreaPreview,
  canInterruptOperatingAreaTool,
  completeOperatingAreaPreview,
  failOperatingAreaPreview,
  finishOperatingAreaConfirmation,
  initialOperatingAreaConfirmationGate,
  initialOperatingAreaToolState,
  operatingAreaConfirmErrorMessage,
  requestOperatingAreaDeactivation,
  selectOperatingAreaCandidate,
} from "@/lib/operating-area-tool";
import type {
  GeoPoint,
  OperatingAreaConfirmResponse,
  OperatingAreaPreviewResponse,
  OperatingRelation,
} from "@/types";

interface UseOperatingAreaToolOptions {
  onConfirmed: (response: OperatingAreaConfirmResponse) => Promise<unknown> | unknown;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function previewErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404) return "Fant ingen teig på dette punktet. Prøv litt lenger inn på jordet.";
    if (error.status === 502 || error.status === 503) return "Eiendomsoppslaget er midlertidig utilgjengelig. Prøv igjen.";
    return error.message;
  }
  return "Kunne ikke slå opp jordet. Kontroller tilkoblingen og prøv igjen.";
}

export function useOperatingAreaTool({ onConfirmed }: UseOperatingAreaToolOptions) {
  const [state, setState] = useState(initialOperatingAreaToolState);
  const [confirmation, setConfirmation] = useState<OperatingAreaConfirmResponse | null>(null);
  const previewSequenceRef = useRef(0);
  const confirmSequenceRef = useRef(0);
  const previewAbortRef = useRef<AbortController | null>(null);
  const confirmationGateRef = useRef(initialOperatingAreaConfirmationGate);

  const selectedCandidate = useMemo(
    () => state.preview?.candidates.find((candidate) => candidate.candidate_id === state.selectedCandidateId) ?? null,
    [state.preview, state.selectedCandidateId],
  );

  const deactivate = useCallback(() => {
    if (confirmationGateRef.current.inFlight) {
      confirmationGateRef.current = requestOperatingAreaDeactivation(confirmationGateRef.current);
      return;
    }
    previewSequenceRef.current += 1;
    confirmSequenceRef.current += 1;
    previewAbortRef.current?.abort();
    setState(initialOperatingAreaToolState);
    setConfirmation(null);
  }, []);

  const activate = useCallback(() => {
    setState((current) => activateOperatingAreaTool(current));
  }, []);

  const toggle = useCallback(
    (next: boolean) => {
      if (next) activate();
      else deactivate();
    },
    [activate, deactivate],
  );

  const inspectPoint = useCallback(async (point: GeoPoint) => {
    if (confirmationGateRef.current.inFlight) return;
    previewAbortRef.current?.abort();
    const controller = new AbortController();
    previewAbortRef.current = controller;
    const requestId = previewSequenceRef.current + 1;
    previewSequenceRef.current = requestId;
    setConfirmation(null);
    setState((current) => beginOperatingAreaPreview(current, requestId, point));
    try {
      const { data } = await apiPost<OperatingAreaPreviewResponse>(
        "/api/v1/operating-area-previews",
        { lat: point.lat, lng: point.lng },
        { signal: controller.signal },
      );
      setState((current) => completeOperatingAreaPreview(current, requestId, data));
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) return;
      setState((current) => failOperatingAreaPreview(current, requestId, previewErrorMessage(error)));
    } finally {
      if (previewAbortRef.current === controller) previewAbortRef.current = null;
    }
  }, []);

  const selectCandidate = useCallback((candidateId: string) => {
    if (confirmationGateRef.current.inFlight) return;
    setState((current) => selectOperatingAreaCandidate(current, candidateId));
  }, []);

  const confirm = useCallback(
    async (operatingRelation: OperatingRelation) => {
      if (!selectedCandidate || !state.point) return;
      const gateStart = beginOperatingAreaConfirmation(confirmationGateRef.current);
      confirmationGateRef.current = gateStart.gate;
      if (!gateStart.started) return;
      const requestId = confirmSequenceRef.current + 1;
      confirmSequenceRef.current = requestId;
      setState((current) => ({ ...current, phase: "confirming", error: null }));
      try {
        const { data } = await apiPut<OperatingAreaConfirmResponse>(
          `/api/v1/operating-areas/${encodeURIComponent(selectedCandidate.candidate_id)}`,
          {
            lat: state.point.lat,
            lng: state.point.lng,
            operating_relation: operatingRelation,
          },
        );
        if (confirmSequenceRef.current !== requestId) return;
        setConfirmation(data);
        setState((current) => ({ ...current, phase: "success", error: null }));
        try {
          await onConfirmed(data);
        } catch (refreshError) {
          // The server mutation already succeeded. Keep the honest success state even if profile refresh fails.
          console.error("Jordet ble lagt til, men profilen kunne ikke oppdateres", refreshError);
        }
      } catch (error) {
        if (confirmSequenceRef.current !== requestId) return;
        const fallback =
          error instanceof ApiError
            ? error.message
            : "Kunne ikke legge til jordet. Kontroller tilkoblingen og prøv igjen.";
        const message = operatingAreaConfirmErrorMessage(error instanceof ApiError ? error.status : null, fallback);
        setState((current) => ({ ...current, phase: "error", error: message }));
      } finally {
        const gateFinish = finishOperatingAreaConfirmation(confirmationGateRef.current);
        confirmationGateRef.current = gateFinish.gate;
        if (gateFinish.shouldDeactivate) {
          previewSequenceRef.current += 1;
          confirmSequenceRef.current += 1;
          setState(initialOperatingAreaToolState);
          setConfirmation(null);
        }
      }
    },
    [onConfirmed, selectedCandidate, state.point],
  );

  useEffect(() => {
    if (!state.active) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && canInterruptOperatingAreaTool(state.phase)) deactivate();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deactivate, state.active, state.phase]);

  useEffect(
    () => () => {
      previewAbortRef.current?.abort();
    },
    [],
  );

  return {
    state,
    confirmation,
    selectedCandidate,
    activate,
    deactivate,
    toggle,
    inspectPoint,
    selectCandidate,
    confirm,
  };
}
