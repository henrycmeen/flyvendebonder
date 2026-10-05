import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";

type MeasurementPeriod = {start: string; end: string};
type Provenance = {raw_value: number; conversion: string | null};
type WeatherDay = {date: string; precipitation_mm: number | null; temperature_c: number | null; precipitation_period: MeasurementPeriod | null; temperature_period: MeasurementPeriod | null; precipitation_provenance?: Provenance | null};
type SeasonWeather = {
  status: string;
  source: {id: string; provider?: string; series: Record<string, string>; station_review?: {station_name: string; distance_m: number; suitability_note: string; reviewed_at: string}} | null;
  period: {start: string; end: string; basis: string; timezone: string};
  days: WeatherDay[];
  precipitation: {observed_sum_mm: number | null; complete: boolean; covered_days: number; expected_days: number};
  temperature: {mean_c: number | null; complete: boolean; covered_days: number; expected_days: number};
  rejected_observations: number;
};
const number = (value: number | null, unit: string) => value == null ? "Mangler" : `${value.toLocaleString("nb-NO", {maximumFractionDigits: 1})} ${unit}`;
const timestamp = (value: string) => `${new Date(value).toLocaleString("nb-NO", {timeZone: "UTC", day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit"})} UTC`;
const period = (value: MeasurementPeriod | null) => value ? `${timestamp(value.start)} – ${timestamp(value.end)}` : "Ingen måling";

export function ComparisonWeather({ propertyId, leftDate, rightDate }: {propertyId: number | null; leftDate: string; rightDate: string}) {
  const [state, setState] = useState<{key: string; data: SeasonWeather | null; failed: boolean} | null>(null);
  const [start, end] = [leftDate, rightDate].sort();
  const key = `${propertyId}/${start}/${end}`;
  useEffect(() => {
    if (propertyId == null) return;
    const controller = new AbortController();
    apiGet<SeasonWeather>("/api/v1/weather/season", {query: {start, end, property_id: propertyId}, signal: controller.signal, retries: 0, cache: false, dedupe: false, notifyAuthFailure: false})
      .then(({data}) => {if (!controller.signal.aborted) setState({key, data, failed: false});})
      .catch(() => {if (!controller.signal.aborted) setState({key, data: null, failed: true});});
    return () => controller.abort();
  }, [propertyId, start, end, key]);
  if (propertyId == null) return <p className="fb-comparison-note">Eiendomstilknytning mangler for værkontekst.</p>;
  if (state?.key !== key) return <p className="fb-comparison-note" role="status">Henter værgrunnlag …</p>;
  const data = state.data;
  if (state.failed || !data?.source || data.status === "unavailable") return <p className="fb-comparison-note" role="status">Værgrunnlag er ikke tilgjengelig for disse datoene ennå.</p>;
  const rain = data.precipitation;
  const temperature = data.temperature;
  return <section className="fb-comparison-note" aria-label="Vær mellom opptaksdatoene">
    <p role="status"><strong>{number(rain.observed_sum_mm, "mm")}</strong> nedbør · {rain.covered_days} av {rain.expected_days} døgn{rain.complete ? "" : " · ufullstendig periode"}</p>
    <p>{number(temperature.mean_c, "°C")} i snitt · {temperature.covered_days} av {temperature.expected_days} døgn{temperature.complete ? "" : " · bare tilgjengelige målinger"}</p>
    <details><summary>Værkilde og måleperioder</summary>
      <p>{data.source.provider ?? "Værkilde"} · {data.source.id}. Stasjonsmålinger, ikke målt på jordet.</p>
      <p>{data.source.station_review && `${data.source.station_review.station_name} · ${(data.source.station_review.distance_m / 1000).toLocaleString("nb-NO", {maximumFractionDigits: 1})} km fra eiendommen. ${data.source.station_review.suitability_note} Vurdert ${data.source.station_review.reviewed_at}.`}</p>
      <p>{data.period.start} – {data.period.end} er kildens referansedatoer. Faktiske UTC-perioder vises nedenfor. Manglende døgn er hull, ikke null. {data.rejected_observations} observasjoner avvist.</p>
      <p>Målt vær er kontekst for bildene og gir ingen avlingsprognose.</p>
      <dl>{Object.entries(data.source.series).map(([element, series]) => <div key={element}><dt>{element}</dt><dd className="break-all">{series}</dd></div>)}</dl>
      <div className="max-h-72 overflow-auto"><table className="w-full text-left"><caption className="text-left">Daglige kontrollerte målinger</caption><thead><tr><th>Dato</th><th>Nedbør / måleperiode</th><th>Temperatur / måleperiode</th></tr></thead><tbody>{data.days.map(day => <tr key={day.date}><th scope="row">{day.date}</th><td>{number(day.precipitation_mm,"mm")}<br />{period(day.precipitation_period)}{day.precipitation_provenance?.conversion && <><br />Kildeverdi: {day.precipitation_provenance.raw_value}. {day.precipitation_provenance.conversion}</>}</td><td>{number(day.temperature_c,"°C")}<br />{period(day.temperature_period)}</td></tr>)}</tbody></table></div>
      <a href="https://frost.met.no/" target="_blank" rel="noreferrer">MET Norway Frost</a>
    </details>
  </section>;
}
