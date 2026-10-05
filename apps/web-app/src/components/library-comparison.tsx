import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { overlappingBounds, validBounds, type ComparisonImage } from "@/lib/library-comparison";
import "./library-comparison.css";

function dateLabel(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("nb-NO", { day: "numeric", month: "long", year: "numeric" });
}
function ComparisonMaps({ left, right }: { left: ComparisonImage; right: ComparisonImage }) {
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState<string[]>([]);
  useEffect(() => {
    const overlap = overlappingBounds(left, right);
    if (!leftRef.current || !rightRef.current || !overlap) return;
    const maps = [leftRef.current, rightRef.current].map(container => L.map(container, { attributionControl: false, zoomControl: true, scrollWheelZoom: false, maxZoom: 22 }));
    const images = [left, right];
    const layers = images.map((item, i) => {
      const bounds = item.bounds!;
      return L.imageOverlay(item.imageUrl!, [[bounds.south, bounds.west], [bounds.north, bounds.east]], { opacity: 1 }).on("error", () => setFailed(current => [...current, item.id])).addTo(maps[i]);
    });
    const bounds = L.latLngBounds([[overlap.south, overlap.west], [overlap.north, overlap.east]]);
    maps.forEach(map => map.fitBounds(bounds, { animate: false }));
    let syncing = false;
    maps.forEach((map, i) => map.on("move zoom", () => {
      if (syncing) return;
      syncing = true;
      maps[1-i].setView(map.getCenter(), map.getZoom(), { animate: false });
      syncing = false;
    }));
    const observer = new ResizeObserver(() => maps.forEach(map => map.invalidateSize({pan:false})));
    observer.observe(leftRef.current); observer.observe(rightRef.current);
    return () => { observer.disconnect(); layers.forEach(layer => layer.off()); maps.forEach(map => map.remove()); };
  }, [left, right]);
  return <div className="fb-comparison-panels">{[left, right].map((item,i) => <div key={item.id} className="fb-comparison-map-wrap"><p className="fb-comparison-caption">{dateLabel(item.date)} · {item.label}</p><div ref={i === 0 ? leftRef : rightRef} className="fb-comparison-map" aria-label={`Ortofoto ${dateLabel(item.date)}. Panorering og zoom følger det andre bildet.`} />{failed.includes(item.id) && <p role="alert" className="fb-comparison-error">Bildet kunne ikke lastes. Velg en annen kilde.</p>}</div>)}</div>;
}
function PhotoPanel({ item }: { item: ComparisonImage | undefined }) {
  const [failed, setFailed] = useState(false);
  if (!item?.imageUrl || failed) return <div className="fb-comparison-empty" role="status">{failed ? "Bildet kunne ikke lastes. Velg en annen kilde." : "Ingen tilgjengelig bildeflate for denne datoen. Velg en annen dato eller kilde."}</div>;
  return <a href={item.imageUrl} target="_blank" rel="noreferrer" aria-label={`Åpne ${item.label} i full størrelse`} className="fb-comparison-photo"><img src={item.imageUrl} alt={`${item.label}, ${dateLabel(item.date)}`} onError={() => setFailed(true)} /></a>;
}

export function LibraryComparison({ images, kind, partial = false }: { images: ComparisonImage[]; kind: "photo" | "orthophoto"; partial?: boolean }) {
  const prefix = `compare_${kind}_`;
  const [selection, setSelection] = useState(() => {
    const query = new URLSearchParams(window.location.search);
    return { open: query.get(prefix + "open") === "1", left: query.get(prefix + "left") ?? "", right: query.get(prefix + "right") ?? "" };
  });
  const scopes = useMemo(() => Array.from(new Set(images.map(item => item.scope))), [images]);
  const left = images.find(item => item.id === selection.left);
  const right = images.find(item => item.id === selection.right);
  const scope = left?.scope ?? right?.scope ?? scopes[0];
  const candidates = images.filter(item => item.scope === scope);
  const dates = Array.from(new Set(candidates.map(item => item.date))).sort();
  const update = (next: typeof selection) => {
    setSelection(next);
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries(next)) url.searchParams.set(prefix + key, key === "open" ? (value ? "1" : "0") : String(value));
    window.history.replaceState(window.history.state, "", url);
  };
  const open = () => {
    const first = left ?? images.find(item => item.id === "jorde-4-orthophoto") ?? images[0];
    const second = right ?? images.find(item => first && item.scope === first.scope && item.date !== first.date && (kind === "photo" || overlappingBounds(first, item)));
    update({open:true, left:first?.id ?? "",right:second?.id ?? ""});
  };
  if (!selection.open) return <button type="button" className="fb-comparison-open" onClick={open} disabled={images.length === 0}>Sammenlign to datoer</button>;
  const overlap = left && right ? overlappingBounds(left,right) : null;
  const sync = kind === "orthophoto" && left && right && left.date !== right.date && left.imageUrl && right.imageUrl && overlap;
  return <section className="fb-comparison" aria-label="Sammenlign to opptaksdatoer">
    <header className="fb-comparison-header"><h2>Sammenlign to datoer</h2><button type="button" onClick={() => update({...selection,open:false})}>Tilbake til biblioteket</button></header>
    <label className="fb-comparison-scope">Eiendom<select value={scope ?? ""} onChange={event => {const items = images.filter(item => item.scope === event.target.value);update({open:true,left:items[0]?.id ?? "",right:items.find(item => item.date !== items[0]?.date)?.id ?? ""});}}>{scopes.map(value => <option key={value}>{value}</option>)}</select></label>
    <div className="fb-comparison-panels fb-comparison-controls">{(["left","right"] as const).map((side,index) => {
      const item = side === "left" ? left : right;
      return <div key={side}><label>{index === 0 ? "Første dato" : "Andre dato"}<select value={item?.date ?? ""} onChange={event => update({...selection,[side]:candidates.find(candidate => candidate.date === event.target.value)?.id ?? ""})}><option value="">Velg dato</option>{dates.map(date => <option key={date} value={date} disabled={date === (side === "left" ? right?.date : left?.date)}>{dateLabel(date)}</option>)}</select></label><label>Kilde<select value={item?.id ?? ""} onChange={event => update({...selection,[side]:event.target.value})}><option value="">Velg kilde</option>{candidates.filter(candidate => candidate.date === item?.date).map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}</select></label><p>{item?.source ?? "Kilde mangler"}</p><p>{kind === "photo" ? "Dekning ukjent · separate utsnitt" : validBounds(item?.bounds) ? "Geografisk utstrekning dokumentert · faktisk bildedekning kan ha hull" : "Geografisk dekning ukjent"}</p></div>;
    })}</div>
    {sync ? <ComparisonMaps key={`${left.id}/${right.id}`} left={left} right={right} /> : <div className="fb-comparison-panels">{[left,right].map((item,index) => <div key={item?.id ?? index}><p className="fb-comparison-caption">{item ? `${dateLabel(item.date)} · ${item.label}` : "Dato eller kilde mangler"}</p><PhotoPanel item={item} /></div>)}</div>}
    <p className="fb-comparison-note">{kind === "photo" ? "Fotoene vises uavhengig. Samme eiendom betyr ikke samme motiv; skråfoto er ikke geometrisk sammenstilt. Åpne et bilde for å undersøke originalvisningen." : sync ? "Panorering og zoom er synkronisert innen geografisk overlapp. Webvisningene kan ha ulik oppløsning, lys og dekning; felttilknytning er ikke verifisert." : "Velg to ulike datoer med geografisk overlapp for synkronisert panorering og zoom. Tilgjengelige bilder kan fortsatt åpnes hver for seg."}</p>
    {partial && <p role="status" className="fb-comparison-note">Bare innlastede bilder er valgbare. Lukk sammenligningen og last inn flere bilder fra biblioteket for flere datoer og kilder.</p>}
  </section>;
}
