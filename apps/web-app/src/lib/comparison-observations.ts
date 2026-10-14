import { observedAtToLocalInput } from "./observed-at";
import type { ScoutingTask } from "../types";

export function isObservationDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

/** Use the recorded observation offset, never the viewer's timezone or task update date. */
export function comparisonObservationTime(task: ScoutingTask) {
  if (!task.observed_at || !/(?:[Zz]|[+-]\d{2}:\d{2})$/.test(task.observed_at)) return null;
  const offset = task.observed_at_original_offset;
  let minutes = 0;
  if (offset != null) {
    if (!/^[+-]\d{2}:\d{2}$/.test(offset)) return null;
    const hours = Number(offset.slice(1, 3));
    const remainder = Number(offset.slice(4));
    if (hours > 23 || remainder > 59) return null;
    minutes = (offset[0] === "-" ? -1 : 1) * (hours * 60 + remainder);
  }
  const local = observedAtToLocalInput(task.observed_at, minutes);
  if (!local) return null;
  return { date: local.slice(0, 10), local, offset: offset ?? "UTC (opprinnelig tidssone ukjent)" };
}

export function observationsBetween(tasks: ScoutingTask[], propertyId: number, firstDate: string, secondDate: string) {
  const [start, end] = [firstDate, secondDate].sort();
  const scoped = tasks.filter(task => task.property_id === propertyId);
  const rows = scoped.flatMap(task => {
    const time = comparisonObservationTime(task);
    return time && time.date >= start && time.date <= end ? [{task, time}] : [];
  }).sort((a, b) => a.time.local.localeCompare(b.time.local) || a.task.id - b.task.id);
  return { rows, undatedCount: scoped.filter(task => !comparisonObservationTime(task)).length };
}
