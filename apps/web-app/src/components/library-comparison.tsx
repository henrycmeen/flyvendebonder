import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import L from "leaflet";
import { ResponsivePageControls } from "./ui/responsive-page-controls";
import { NativeSelect } from "./ui/native-select";
import { LibraryNavigation } from "./library-navigation";
import { ComparisonWeather } from "./comparison-weather";
import { ComparisonObservations } from "./comparison-observations";
import { overlappingBounds, rankPhotoComparisonCandidates, validBounds, type ComparisonImage } from "@/lib/library-comparison";
import "./library-comparison.css";

function dateLabel(date: string, compact = false) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("nb-NO", { day: compact ? "2-digit" : "numeric", month: compact ? "2-digit" : "long", year: "numeric" });
}
function ComparisonMaps({ left, right }: { left: ComparisonImage; right: ComparisonImage }) {
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const overlap = overlappingBounds(left, right);
  const leftId = left.id;
  const rightId = right.id;
  const leftUrl = left.imageUrl;
  const rightUrl = right.imageUrl;
  const leftSouth = left.bounds?.south;
  const leftWest = left.bounds?.west;
  const leftNorth = left.bounds?.north;
  const leftEast = left.bounds?.east;
  const rightSouth = right.bounds?.south;
  const rightWest = right.bounds?.west;
  const rightNorth = right.bounds?.north;
  const rightEast = right.bounds?.east;
  const overlapSouth = overlap?.south;
  const overlapWest = overlap?.west;
  const overlapNorth = overlap?.north;
  const overlapEast = overlap?.east;
  useEffect(() => {
    if (!leftRef.current || !rightRef.current || !leftUrl || !rightUrl ||
      leftSouth == null || leftWest == null || leftNorth == null || leftEast == null ||
      rightSouth == null || rightWest == null || rightNorth == null || rightEast == null ||
      overlapSouth == null || overlapWest == null || overlapNorth == null || overlapEast == null) return;
    const maps = [leftRef.current, rightRef.current].map(container => L.map(container, { attributionControl: false, zoomControl: false, scrollWheelZoom: true, maxZoom: 22 }));
    const sources = [
      { id: leftId, url: leftUrl, bounds: L.latLngBounds([[leftSouth, leftWest], [leftNorth, leftEast]]) },
      { id: rightId, url: rightUrl, bounds: L.latLngBounds([[rightSouth, rightWest], [rightNorth, rightEast]]) },
    ];
    const layers = sources.map((item, i) => L.imageOverlay(item.url, item.bounds, { opacity: 1 })
      .on("error", () => setFailed(current => current.includes(item.id) ? current : [...current, item.id])).addTo(maps[i]));
    const bounds = L.latLngBounds([[overlapSouth, overlapWest], [overlapNorth, overlapEast]]);
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
  }, [leftId, rightId, leftUrl, rightUrl, leftSouth, leftWest, leftNorth, leftEast, rightSouth, rightWest, rightNorth, rightEast, overlapSouth, overlapWest, overlapNorth, overlapEast]);
  return <div className="fb-comparison-panels">{[left, right].map((item,i) => <div key={item.id} className="fb-comparison-map-wrap"><p className="fb-comparison-caption">{dateLabel(item.date)} · {item.label}</p><div ref={i === 0 ? leftRef : rightRef} className="fb-comparison-map" aria-label={`Ortofoto ${dateLabel(item.date)}. Panorering og zoom følger det andre bildet.`} />{failed.includes(item.id) && <p role="alert" className="fb-comparison-error">Bildet kunne ikke lastes. Velg en annen kilde.</p>}</div>)}</div>;
}
function PhotoPanel({ item }: { item: ComparisonImage | undefined }) {
  const [failed, setFailed] = useState(false);
  if (!item?.imageUrl || failed) return <div className="fb-comparison-empty" role="status">{failed ? "Bildet kunne ikke lastes. Velg en annen kilde." : "Ingen tilgjengelig bildeflate for denne datoen. Velg en annen dato eller kilde."}</div>;
  return <a href={item.imageUrl} target="_blank" rel="noreferrer" aria-label={`Åpne ${item.label} i full størrelse`} className="fb-comparison-photo"><img src={item.imageUrl} alt={`${item.label}, ${dateLabel(item.date)}`} onError={() => setFailed(true)} /></a>;
}

export function LibraryComparison({ images, kind, partial = false, onChangeLibraryView, children }: { images: ComparisonImage[]; kind: "photo" | "orthophoto"; partial?: boolean; onChangeLibraryView: (view: "album" | "orthophotos") => void; children: ReactNode }) {
  const prefix = `compare_${kind}_`;
  const [selection, setSelection] = useState<{open:boolean;left:string;right:string;date:string;scope?:string}>(() => {
    const query = new URLSearchParams(window.location.search);
    return { open: query.get(prefix + "open") === "1", left: query.get(prefix + "left") ?? "", right: query.get(prefix + "right") ?? "", date: query.get(prefix + "date") ?? "", scope:query.get(prefix + "scope") ?? undefined };
  });
  useEffect(() => {
    const restore = () => {
      const query = new URLSearchParams(window.location.search);
      setSelection({open: query.get(prefix + "open") === "1", left: query.get(prefix + "left") ?? "", right: query.get(prefix + "right") ?? "", date: query.get(prefix + "date") ?? "", scope:query.get(prefix + "scope") ?? undefined});
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [prefix]);
  const scopes = useMemo(() => Array.from(new Set(images.map(item => item.scope))), [images]);
  const left = images.find(item => item.id === selection.left);
  const selectedRight = images.find(item => item.id === selection.right);
  const targetDate = selection.date || selectedRight?.date || "";
  const matches = kind === "photo" && left ? rankPhotoComparisonCandidates(left, images, targetDate || undefined) : null;
  const right = kind === "photo" ? matches?.candidates.find(candidate => candidate.image.id === selection.right)?.image : selectedRight;
  const placeMatch = matches?.candidates.find(candidate => candidate.image.id === right?.id);
  const scope = left?.scope ?? (selection.scope && scopes.includes(selection.scope) ? selection.scope : undefined) ?? right?.scope ?? scopes[0];
  const candidates = images.filter(item => item.scope === scope);
  const dates = Array.from(new Set(candidates.map(item => item.date))).sort();
  const update = (next: typeof selection) => {
    setSelection(next);
    const url = new URL(window.location.href);
    for (const key of ["open", "left", "right", "date", "scope"] as const) {
      const value = next[key];
      if (value == null || value === "") url.searchParams.delete(prefix + key);
      else url.searchParams.set(prefix + key, key === "open" ? (value ? "1" : "0") : String(value));
    }
    if (next.open && !selection.open) window.history.pushState(window.history.state, "", url);
    else window.history.replaceState(window.history.state, "", url);
  };
  const choosePhoto = (anchor: ComparisonImage, date = targetDate) => {
    const otherDate = date === anchor.date ? "" : date;
    const match = rankPhotoComparisonCandidates(anchor, images, otherDate || undefined).candidates[0];
    update({open:true,left:anchor.id,right:match?.image.id ?? "",date:otherDate || match?.image.date || ""});
  };
  const open = () => {
    if (kind === "photo") {
      const queryPhoto = new URLSearchParams(window.location.search).get("photo");
      const anchor = left ?? images.find(item => item.id === queryPhoto);
      if (anchor) choosePhoto(anchor);
      else update({open:true,left:"",right:"",date:""});
      return;
    }
    const first = left ?? images.find(item => item.id === "jorde-4-orthophoto") ?? images[0];
    const alternatives = images.filter(item => first && item.scope === first.scope && item.date !== first.date && overlappingBounds(first, item));
    const second = right ?? alternatives.find(item => item.canonicalSource) ?? alternatives[0];
    update({open:true, left:first?.id ?? "",right:second?.id ?? "",date:""});
  };
  const libraryView: "album" | "orthophotos" = kind === "photo" ? "album" : "orthophotos";
  const navigationProps = { active: selection.open ? "comparison" as const : libraryView, onChange: (view: "album" | "orthophotos" | "comparison") => {
    if (view === "comparison") { if (!selection.open) open(); return; }
    update({...selection, open:false});
    if (view !== libraryView) onChangeLibraryView(view);
  }};
  if (!selection.open) return <LibraryNavigation {...navigationProps}>{children}</LibraryNavigation>;
  const overlap = left && right ? overlappingBounds(left,right) : null;
  const sync = kind === "orthophoto" && left && right && left.date !== right.date && left.imageUrl && right.imageUrl && overlap;
  return <LibraryNavigation {...navigationProps}><section className="fb-comparison" aria-label="Sammenlign to opptaksdatoer">
    <header className="sr-only"><h2>{kind === "photo" ? "Sammenlign samme sted" : "Sammenlign to datoer"}</h2></header>
    {(kind === "orthophoto" || left || scopes.length > 1) && <ResponsivePageControls label="Velg opptak" summary={left && right ? `${dateLabel(left.date)} · ${dateLabel(right.date)}` : left ? dateLabel(left.date) : undefined}>
      <div className="fb-comparison-options">
    {scopes.length > 1 && <label className="fb-comparison-scope">Eiendom<NativeSelect value={scope ?? ""} onChange={event => {const items = images.filter(item => item.scope === event.target.value);if(kind === "photo") update({open:true,left:"",right:"",date:"",scope:event.target.value}); else update({open:true,left:items[0]?.id ?? "",right:items.find(item => item.date !== items[0]?.date)?.id ?? "",date:""});}}>{scopes.map(value => <option key={value}>{value}</option>)}</NativeSelect></label>}
        {kind === "photo" ? (left ? <div className="fb-comparison-panels fb-comparison-controls">
        <fieldset className="fb-comparison-choice"><legend>Utgangspunkt</legend><label>Bilde<NativeSelect value={left.id} onChange={event => {const anchor=images.find(item => item.id === event.target.value);if(anchor) choosePhoto(anchor);}}>{candidates.map(item => <option key={item.id} value={item.id}>{dateLabel(item.date, true)} · {item.label}</option>)}</NativeSelect></label></fieldset>
        <fieldset className="fb-comparison-choice"><legend>Sammenlign med</legend><label>Andre dato<NativeSelect value={targetDate} onChange={event => choosePhoto(left,event.target.value)}><option value="">Velg dato</option>{dates.filter(date => date !== left.date).map(date => <option key={date} value={date}>{dateLabel(date, true)}</option>)}</NativeSelect></label>
          <label>Nærliggende bilde<NativeSelect value={right?.id ?? ""} onChange={event => update({...selection,right:event.target.value})}><option value="">Velg bilde</option>{matches?.candidates.map(candidate => <option key={candidate.image.id} value={candidate.image.id}>{candidate.image.label} · {Math.round(candidate.distanceM)} m fra utgangspunktet</option>)}</NativeSelect></label>
          {!right && matches?.candidates[0] && <button className="fb-comparison-open" type="button" onClick={() => choosePhoto(left)}>Bruk nærmeste bilde</button>}
        </fieldset>
      </div> : null) : <div className="fb-comparison-panels fb-comparison-controls">{(["left","right"] as const).map((side,index) => {
      const item = side === "left" ? left : right;
      return <fieldset key={side} className="fb-comparison-choice"><legend>{index === 0 ? "Første opptak" : "Andre opptak"}</legend><label>{index === 0 ? "Første dato" : "Andre dato"}<NativeSelect value={item?.date ?? ""} onChange={event => update({...selection,[side]:candidates.find(candidate => candidate.date === event.target.value)?.id ?? ""})}><option value="">Velg dato</option>{dates.map(date => <option key={date} value={date} disabled={date === (side === "left" ? right?.date : left?.date)}>{dateLabel(date, true)}</option>)}</NativeSelect></label><label>Kilde<NativeSelect value={item?.id ?? ""} onChange={event => update({...selection,[side]:event.target.value})}><option value="">Velg kilde</option>{candidates.filter(candidate => candidate.date === item?.date).map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}</NativeSelect></label>{!item && <p>Kilde mangler</p>}{kind === "orthophoto" && !validBounds(item?.bounds) && <p>Geografisk dekning ukjent</p>}</fieldset>;
    })}</div>}
      </div>
    </ResponsivePageControls>}
    {kind === "photo" && <>
      {!left && <div className="fb-comparison-anchor-picker">
        <p>Velg et bilde som utgangspunkt</p>
        <div className="fb-comparison-anchor-grid">{candidates.map(item => <button key={item.id} type="button" onClick={() => choosePhoto(item, "")} aria-label={`Sammenlign fra ${item.label}, ${dateLabel(item.date)}`}>
          {item.thumbnailUrl && <img src={item.thumbnailUrl} alt="" loading="lazy" />}<span>{dateLabel(item.date)} · {item.label}</span>
        </button>)}</div>
      </div>}

      {left && !right && <p role="status" className="fb-comparison-note">{matches?.status === "unknown-location" ? "Posisjonsgrunnlaget mangler for denne sammenligningen. Velg en annen dato eller et annet bilde." : matches?.candidates.length ? "De tidligere valgte bildene viser ikke omtrent samme sted. Velg et nærliggende bilde." : "Ingen nærliggende opptak med tilsvarende kameravinkel er funnet på denne datoen blant de innlastede bildene. Velg en annen dato eller et annet utgangspunkt."}</p>}
      {placeMatch && <details className="fb-comparison-note"><summary>Bildematch · {Math.round(placeMatch.distanceM)} m mellom posisjonene</summary><p>{Math.round(placeMatch.distanceM)} m mellom {placeMatch.positionType === "view-target" ? "beregnede motivposisjoner" : "kameraposisjoner"}. {placeMatch.directionStatus === "unknown" ? "Kameraretning er ukjent; kontroller at motivene stemmer." : "Kameravinklene er omtrent like; kontroller at motivene stemmer."} {placeMatch.positionType === "view-target" && placeMatch.targetConfidenceStatus !== "reported" && (placeMatch.targetConfidenceStatus === "low" ? "Beregnet motivposisjon har lav sikkerhet." : "Sikkerheten i beregnet motivposisjon er ukjent.")}</p></details>}
    </>}
    {(kind !== "photo" || left) && (sync ? <ComparisonMaps key={`${left.id}/${right.id}`} left={left} right={right} /> : <div className="fb-comparison-panels">{[left,right].map((item,index) => <div key={item?.id ?? index}><p className="fb-comparison-caption">{item ? `${dateLabel(item.date)} · ${item.label}` : "Dato eller kilde mangler"}</p><PhotoPanel item={item} /></div>)}</div>)}
    <p className="fb-comparison-note">{kind === "photo" ? "Nærliggende opptak er forslag, ikke automatisk justerte bilder. Posisjon og kameravinkel garanterer ikke samme motiv." : sync ? "Webforhåndsvisninger · utsnittene følger hverandre. Dekning og lys kan variere; dette er en visuell sammenligning." : "Webforhåndsvisninger · velg to ulike datoer med geografisk overlapp for synkroniserte utsnitt."}</p>
    {(left || right) && <details className="fb-comparison-note"><summary>Kildeinformasjon</summary>{[left, right].map((item, index) => item && <div key={`${index}/${item.id}`}><p>{dateLabel(item.date)} · {item.source}</p>{item.limitations?.map(note => <p key={note}>{note}</p>)}{item.canonicalSource && <details><summary>Registrert originalraster</summary><p>{item.canonicalSource.crs} · {item.canonicalSource.widthPx} × {item.canonicalSource.heightPx} piksler</p><p className="break-all">SHA256: {item.canonicalSource.sha256}</p></details>}</div>)}</details>}
    {partial && <p role="status" className="fb-comparison-note">Bare innlastede bilder er valgbare. Velg Bilder og last inn flere opptak for flere datoer og kilder.</p>}
    {left && right && left.date !== right.date && <ComparisonWeather key={`${left.date}/${right.date}`} propertyId={left.propertyId != null && left.propertyId === right.propertyId ? left.propertyId : null} leftDate={left.date} rightDate={right.date} />}
    {left && right && left.date !== right.date && <ComparisonObservations propertyId={left.propertyId != null && left.propertyId === right.propertyId ? left.propertyId : null} leftDate={left.date} rightDate={right.date} />}
  </section></LibraryNavigation>;
}
