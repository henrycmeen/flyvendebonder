import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";
import { isObservationDate, observationsBetween } from "@/lib/comparison-observations";
import type { ScoutingTaskListResponse } from "@/types";

type ObservationState =
  | {key: string; status: "available"; result: ReturnType<typeof observationsBetween>}
  | {key: string; status: "unavailable"};

interface ComparisonObservationsProps {
  /** Resolve this from the active property list; do not derive it from image GPS/bounds. */
  propertyId: number | null;
  leftDate: string;
  rightDate: string;
}

export function ComparisonObservations({ propertyId, leftDate, rightDate }: ComparisonObservationsProps) {
  const [state, setState] = useState<ObservationState | null>(null);
  const [start, end] = [leftDate, rightDate].sort();
  const valid = propertyId != null && Number.isInteger(propertyId) && propertyId > 0 && isObservationDate(start) && isObservationDate(end);
  const key = `${propertyId}/${start}/${end}`;
  useEffect(() => {
    if (!valid || propertyId == null) return;
    const controller = new AbortController();
    apiGet<ScoutingTaskListResponse>("/api/v1/scouting/tasks", {
      query: {property_id: propertyId}, signal: controller.signal,
      retries: 0, cache: false, dedupe: false, notifyAuthFailure: false,
    }).then(({data}) => {
      if (controller.signal.aborted) return;
      if (data.property_id !== propertyId || !Array.isArray(data.tasks)) {
        setState({key, status: "unavailable"});
        return;
      }
      setState({key, status: "available", result: observationsBetween(data.tasks, propertyId, start, end)});
    }).catch(() => {
      if (!controller.signal.aborted) setState({key, status: "unavailable"});
    });
    return () => controller.abort();
  }, [valid, propertyId, start, end, key]);

  if (!valid) return <p className="fb-comparison-note" role="status">Feltobservasjoner er ikke tilgjengelige før eiendom og to gyldige datoer er valgt.</p>;
  const current = state?.key === key ? state : null;
  if (!current) return <p className="fb-comparison-note" role="status">Henter registrerte feltobservasjoner …</p>;
  if (current.status === "unavailable") return <p className="fb-comparison-note" role="status">Feltobservasjoner er ikke tilgjengelige for valgt eiendom nå.</p>;
  const {rows, undatedCount} = current.result;
  return <details className="fb-comparison-note">
    <summary>Registrerte feltobservasjoner · {rows.length} i perioden</summary>
    <p>{start} – {end} · kilde: registrerte feltoppgaver for valgt eiendom.</p>
    {rows.length === 0 ? <p role="status">Ingen registrerte feltobservasjoner med kjent observasjonstidspunkt i perioden.</p> : <ul className="mt-2 space-y-3">{rows.map(({task, time}) => <li key={task.id}>
      <p className="font-medium">{task.title}</p>
      <p><time dateTime={task.observed_at!}>{time.local.replace("T", " kl. ")}</time> · {time.offset} · felt {task.field_id}</p>
      {task.notes && <p className="whitespace-pre-wrap">{task.notes}</p>}
    </li>)}</ul>}
    {undatedCount > 0 && <p>{undatedCount} feltoppgaver mangler gyldig observasjonstidspunkt og kan ikke plasseres i perioden.</p>}
    <p className="mt-2">Områdetilknytning til bildene er ukjent. Oppgavene kan være oppdatert etter observasjonen; dette er registrert kontekst, ikke en historisk tilstand eller vurdering av bildene.</p>
  </details>;
}
