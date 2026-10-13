import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";
import { buildWeatherRainSeries, weatherPeriodError, yearToDatePeriod, utcWeatherDate } from "@/lib/weather-series";

type MeasurementPeriod = {start: string; end: string};
type Provenance = {raw_value: number; conversion: string | null};
type WeatherDay = {date: string; precipitation_mm: number | null; temperature_c: number | null; precipitation_period: MeasurementPeriod | null; temperature_period: MeasurementPeriod | null; precipitation_provenance?: Provenance | null};
type SeasonWeather = {
  status: string;
  source: {id: string; provider?: string; dataset?: string; series: Record<string, string>; station_review?: {station_name: string; distance_m: number; suitability_note: string; reviewed_at: string}} | null;
  period: {start: string; end: string; basis: string; timezone: string};
  days: WeatherDay[];
  precipitation: {observed_sum_mm: number | null; complete: boolean; covered_days: number; expected_days: number};
  temperature: {mean_c: number | null; complete: boolean; covered_days: number; expected_days: number};
  rejected_observations: number;
};
const number = (value: number | null, unit: string) => value == null ? "Mangler" : `${value.toLocaleString("nb-NO", {maximumFractionDigits: 1})} ${unit}`;
const timestamp = (value: string) => `${new Date(value).toLocaleString("nb-NO", {timeZone: "UTC", day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit"})} UTC`;
const period = (value: MeasurementPeriod | null) => value ? `${timestamp(value.start)} – ${timestamp(value.end)}` : "Ingen måling";

type PeriodSelection = {captureKey: string; start: string; end: string};
function RainSeries({days, start, end}: {days: WeatherDay[]; start: string; end: string}) {
  const series = buildWeatherRainSeries(days, start, end);
  const maxRain = Math.max(1, ...series.days.map(day => day.rainMm ?? 0));
  const maxCumulative = Math.max(1, series.availableSumMm ?? 0);
  const x = (index: number) => 42 + (index + 0.5) / series.days.length * 520;
  const segments: string[] = [];
  let segment = "";
  series.days.forEach((day, index) => {
    if (day.cumulativeAvailableMm == null) { if (segment) segments.push(segment); segment = ""; return; }
    segment += `${segment ? " L" : "M"}${x(index)},${158 - day.cumulativeAvailableMm / maxCumulative * 45}`;
  });
  if (segment) segments.push(segment);
  return <details><summary>Nedbør over tid og per måned</summary>
    <figure className="my-3 min-w-0">
      <svg viewBox="0 0 600 190" className="block w-full" role="img" aria-label={`Daglig nedbør og akkumulert sum av tilgjengelige døgn fra ${start} til ${end}. Manglende døgn bryter kurven.`}>
        <text x="42" y="14" fontSize="12" fill="currentColor">Daglig nedbør · mm</text>
        <text x="42" y="105" fontSize="12" fill="currentColor">Akkumulert tilgjengelig nedbør · mm</text>
        <text x="8" y="33" fontSize="10" fill="currentColor">{number(maxRain, "")}</text>
        <text x="8" y="120" fontSize="10" fill="currentColor">{number(maxCumulative, "")}</text>
        <path d="M42 77H562 M42 158H562" stroke="currentColor" opacity="0.25" fill="none" />
        {series.days.map((day, index) => day.rainMm == null
          ? <rect key={day.date} x={x(index) - 0.7} y="81" width="1.4" height="4" fill="currentColor" opacity="0.45"><title>{day.date}: mangler</title></rect>
          : <rect key={day.date} x={x(index) - Math.max(0.4, 220 / series.days.length)} y={77 - Math.max(0.8, day.rainMm / maxRain * 48)} width={Math.max(0.8, 440 / series.days.length)} height={Math.max(0.8, day.rainMm / maxRain * 48)} fill="#247a65"><title>{day.date}: {number(day.rainMm, "mm")}</title></rect>)}
        {segments.map((path, index) => <path key={index} d={path} fill="none" stroke="#315c92" strokeWidth="2" />)}
        {series.days.map((day, index) => day.cumulativeAvailableMm != null && <circle key={day.date} cx={x(index)} cy={158 - day.cumulativeAvailableMm / maxCumulative * 45} r="1" fill="#315c92"><title>{day.date}: tilgjengelig sum {number(day.cumulativeAvailableMm, "mm")}</title></circle>)}
        <text x="42" y="181" fontSize="11" fill="currentColor">{start}</text><text x="562" y="181" fontSize="11" textAnchor="end" fill="currentColor">{end}</text>
      </svg>
      <figcaption>Døgn med manglende nedbør har markør under aksen og hull i kurven. 0 mm er en måling. Kurven summerer bare tilgjengelige døgn{series.complete ? "; hele intervallet er dekket." : " og er ikke en fullstendig periodesum."}</figcaption>
    </figure>
    <table className="w-full text-left text-xs"><caption className="text-left">Måneder i valgt intervall · tilgjengelig dekning</caption><thead><tr><th>Måned</th><th>Tilgjengelig sum</th><th>Dekning</th></tr></thead><tbody>{series.months.map(month => <tr key={month.month}><th scope="row">{month.month}</th><td>{number(month.availableSumMm, "mm")}</td><td>{month.coveredDays}/{month.selectedDays} valgte døgn{month.selectedDays < month.calendarDays ? " · del av måned" : ""}{month.coveredDays < month.selectedDays ? " · mangler døgn" : ""}</td></tr>)}</tbody></table>
    <p>Månedssummen gjelder valgte døgn. En hel måned krever målinger for alle månedens døgn.</p>
  </details>;
}

export function ComparisonWeather({ propertyId, leftDate, rightDate }: {propertyId: number | null; leftDate: string; rightDate: string}) {
  const [state, setState] = useState<{key: string; data: SeasonWeather | null; failed: boolean} | null>(null);
  const [selection, setSelection] = useState<PeriodSelection | null>(null);
  const [requestAttempt, setRequestAttempt] = useState(0);
  const [draft, setDraft] = useState<PeriodSelection | null>(null);
  const [submissionError, setSubmissionError] = useState<{captureKey: string; message: string} | null>(null);
  const [captureStart, captureEnd] = [leftDate, rightDate].sort();
  const captureKey = `${captureStart}/${captureEnd}`;
  const selected = selection?.captureKey === captureKey ? selection : {captureKey, start: captureStart, end: captureEnd};
  const edited = draft?.captureKey === captureKey ? draft : selected;
  const {start, end} = selected;
  const today = utcWeatherDate(new Date());
  const yearToDate = yearToDatePeriod(today);
  const activeError = weatherPeriodError(start, end, today);
  const draftError = weatherPeriodError(edited.start, edited.end, today);
  const formError = submissionError?.captureKey === captureKey ? submissionError.message : draftError;
  const key = `${propertyId}/${start}/${end}/${requestAttempt}`;
  useEffect(() => {
    if (propertyId == null || activeError) return;
    const controller = new AbortController();
    apiGet<SeasonWeather>("/api/v1/weather/season", {query: {start, end, property_id: propertyId}, signal: controller.signal, retries: 0, cache: false, dedupe: false, notifyAuthFailure: false})
      .then(({data}) => {if (!controller.signal.aborted) setState({key, data, failed: false});})
      .catch(() => {if (!controller.signal.aborted) setState({key, data: null, failed: true});});
    return () => controller.abort();
  }, [propertyId, start, end, key, activeError]);
  if (propertyId == null) return <p className="fb-comparison-note">Eiendomstilknytning mangler for værkontekst.</p>;
  const data = state?.key === key ? state.data : null;
  const available = !activeError && state?.key === key && !state.failed && data?.source && data.status !== "unavailable";
  const availableDates = (data?.days ?? []).filter(day => day.date >= start && day.date <= end && (
    (day.precipitation_mm != null && Number.isFinite(day.precipitation_mm) && day.precipitation_mm >= 0)
    || (day.temperature_c != null && Number.isFinite(day.temperature_c))
  )).map(day => day.date).sort();
  const latestAvailableDate = availableDates[availableDates.length - 1];
  const rain = data?.precipitation;
  const temperature = data?.temperature;
  const choose = (start: string, end: string) => {const next = {captureKey, start, end}; setSelection(next); setDraft(next); setSubmissionError(null); setRequestAttempt(current => current + 1);};
  return <section className="fb-comparison-note min-w-0" aria-label="Værkontekst for opptakene">
    <details><summary>Velg værperiode · {start} – {end}</summary>
      <div className="my-2 flex flex-wrap gap-3"><button type="button" className="underline" onClick={() => choose(captureStart, captureEnd)}>Mellom opptakene</button><button type="button" className="underline" onClick={() => choose(`${captureEnd.slice(0, 4)}-01-01`, captureEnd)}>Året til siste opptak</button><button type="button" className="underline" onClick={() => choose(yearToDate.start, yearToDate.end)}>År til dato · {today} UTC</button></div>
      <form onSubmit={event => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        const startValue = values.get("start"), endValue = values.get("end");
        const submittedStart = typeof startValue === "string" ? startValue : "";
        const submittedEnd = typeof endValue === "string" ? endValue : "";
        const error = weatherPeriodError(submittedStart, submittedEnd, today);
        if (error) { setSubmissionError({captureKey, message: error}); return; }
        choose(submittedStart, submittedEnd);
      }}>
        <div className="grid grid-cols-2 gap-2"><label className="min-w-0">Fra<input className="block w-full min-w-0 rounded border bg-transparent p-1" type="date" name="start" max={today} value={edited.start} onChange={event => {setSubmissionError(null); setDraft({...edited, start: event.target.value});}} /></label><label className="min-w-0">Til<input className="block w-full min-w-0 rounded border bg-transparent p-1" type="date" name="end" min={edited.start} max={today} value={edited.end} onChange={event => {setSubmissionError(null); setDraft({...edited, end: event.target.value});}} /></label></div>
        <p>Høyst 367 døgn, fram til dagens UTC-dato ({today}). Værintervallet endrer ikke valgte opptak.</p>
        {formError && <p role="status">{formError}</p>}<button type="submit" className="underline">Vis valgt periode</button>
      </form>
    </details>
    {activeError ? <p role="status">{activeError}</p> : state?.key !== key ? <p role="status">Henter værgrunnlag …</p> : !available ? <p role="status">Værgrunnlag er ikke tilgjengelig for dette intervallet ennå.</p> : data && rain && temperature && <>
      <p role="status"><strong>{number(rain.observed_sum_mm, "mm")}</strong> {rain.complete ? "nedbør i perioden" : "sum av tilgjengelig nedbør"} · {rain.covered_days} av {rain.expected_days} døgn{rain.complete ? "" : " · ufullstendig periode"}</p>
      <p>{number(temperature.mean_c, "°C")} i snitt · {temperature.covered_days} av {temperature.expected_days} døgn{temperature.complete ? "" : " · bare tilgjengelige målinger"}</p>
      <p>{latestAvailableDate ? `Siste tilgjengelige referansedato med godkjent måling: ${latestAvailableDate}.` : "Ingen godkjente måledøgn i intervallet."}</p>
      <RainSeries days={data.days} start={start} end={end} />
      <details><summary>Værkilde og måleperioder</summary>
        <p>{data.source?.provider ?? "Værkilde"} · {data.source?.id}. Stasjonsmålinger, ikke målt på jordet.</p>
        <p>{data.source?.station_review && `${data.source.station_review.station_name} · ${(data.source.station_review.distance_m / 1000).toLocaleString("nb-NO", {maximumFractionDigits: 1})} km fra eiendommen. ${data.source.station_review.suitability_note} Vurdert ${data.source.station_review.reviewed_at}.`}</p>
        <p>{data.period.start} – {data.period.end} er kildens referansedatoer. Faktiske UTC-perioder vises nedenfor. Manglende døgn er hull, ikke null. {data.rejected_observations} observasjoner avvist.</p>
        <p>Målt vær er kontekst for bildene og gir ingen avlingsprognose.</p>
        <details><summary>Teknisk serieidentitet</summary><dl>{Object.entries(data.source?.series ?? {}).map(([element, series]) => <div key={element}><dt>{element}</dt><dd className="break-all">{series}</dd></div>)}</dl></details>
        <div className="max-h-72 overflow-auto"><table className="w-full text-left"><caption className="text-left">Daglige kontrollerte målinger</caption><thead><tr><th>Dato</th><th>Nedbør / måleperiode</th><th>Temperatur / måleperiode</th></tr></thead><tbody>{data.days.map(day => <tr key={day.date}><th scope="row">{day.date}</th><td>{number(day.precipitation_mm,"mm")}<br />{period(day.precipitation_period)}{day.precipitation_provenance?.conversion && <><br />Kildeverdi: {day.precipitation_provenance.raw_value}. {day.precipitation_provenance.conversion === "documented_no_precipitation_minus_one_to_zero" ? "Kilden bruker −1 for ingen nedbør; vist som 0 mm." : "Normalisert av kildeadapteren."}</>}</td><td>{number(day.temperature_c,"°C")}<br />{period(day.temperature_period)}</td></tr>)}</tbody></table></div>
        <a href={data.source?.dataset?.startsWith("seKlima") ? "https://seklima.met.no/" : "https://frost.met.no/"} target="_blank" rel="noreferrer">{data.source?.dataset?.startsWith("seKlima") ? "MET Norway seKlima" : "MET Norway Frost"}</a>
      </details>
    </>}
  </section>;
}
