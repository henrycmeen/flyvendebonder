import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw, X } from "lucide-react";
import { GlassSurface } from "@/components/ui/glass-surface";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { buildCaptureSequence, formatCaptureTimestamp } from "@/lib/capture-sequence";
import type { PhotoFeature } from "@/types";

export interface CapturePlayerProps {
  photos: PhotoFeature[];
  hasMore: boolean;
  isLoadingMore: boolean;
  loadFailed: boolean;
  onLoadMore: () => void;
  onClose: () => void;
}

export function CapturePlayer(props: CapturePlayerProps) {
  const sequence = useMemo(() => buildCaptureSequence(props.photos), [props.photos]);
  // A changed sequence starts a fresh, paused session, even before effects run.
  const sequenceKey = JSON.stringify(sequence.photos.map((photo) => [photo.id, photo.captured_at, photo.image_url, photo.thumbnail_url]));
  return <CapturePlayerSession key={sequenceKey} {...props} photos={sequence.photos} excludedCount={sequence.excludedCount} />;
}

function CapturePlayerSession({ photos, excludedCount, hasMore, isLoadingMore, loadFailed, onLoadMore, onClose }: CapturePlayerProps & { excludedCount: number }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [seconds, setSeconds] = useState(2);
  const [retry, setRetry] = useState(0);
  const [imageState, setImageState] = useState<{ key: string; status: "loaded" | "error" } | null>(null);
  const photo = photos[index];
  const source = photo?.image_url?.trim() || photo?.thumbnail_url?.trim() || "";
  const frameKey = JSON.stringify([index, source, retry]);
  const currentFrameKey = useRef<string | null>(null);
  useLayoutEffect(() => {
    currentFrameKey.current = frameKey;
    return () => { currentFrameKey.current = null; };
  }, [frameKey]);
  const loaded = imageState?.key === frameKey && imageState.status === "loaded";
  const failed = !source || (imageState?.key === frameKey && imageState.status === "error");
  const atEnd = index >= photos.length - 1;
  const unknownTimezone = photos.some((entry) => formatCaptureTimestamp(entry.captured_at).includes("tidssone ukjent"));

  useEffect(() => {
    if (!playing || !loaded || atEnd) return;
    const timer = window.setTimeout(() => {
      setRetry((value) => value + 1);
      setIndex((current) => current + 1);
      const next = photos[index + 1];
      if (index + 1 >= photos.length - 1 || !(next?.image_url?.trim() || next?.thumbnail_url?.trim())) setPlaying(false);
    }, seconds * 1000);
    return () => window.clearTimeout(timer);
  }, [playing, loaded, atEnd, seconds, index, photos]);

  useEffect(() => {
    const pauseWhenHidden = () => { if (document.hidden) setPlaying(false); };
    document.addEventListener("visibilitychange", pauseWhenHidden);
    return () => document.removeEventListener("visibilitychange", pauseWhenHidden);
  }, []);

  function navigate(delta: number) {
    setPlaying(false);
    setRetry((value) => value + 1);
    setIndex((current) => Math.max(0, Math.min(photos.length - 1, current + delta)));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target instanceof HTMLElement && event.target.closest("button, input, select, textarea, a, [contenteditable=true], [role=button]")) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
    if (event.key === "ArrowLeft") { event.preventDefault(); navigate(-1); }
    if (event.key === "ArrowRight") { event.preventDefault(); navigate(1); }
    if (event.code === "Space") {
      event.preventDefault();
      if (playing) setPlaying(false);
      else if (loaded && !atEnd && !document.hidden) setPlaying(true);
    }
  }

  return (
    <div className="min-w-0 space-y-3 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-fb-focus" tabIndex={0} onKeyDown={handleKeyDown} aria-label="Kronologisk bildeavspilling">
      <div className="flex items-start justify-between gap-3 pr-6">
        <div className="min-w-0">
          <p className="text-lg font-semibold">Bilder over tid</p>
          <p className="text-sm text-fb-text-secondary">Kronologisk avspilling av innlastede bilder. Kameravinkel og utsnitt kan endre seg; bildene er ikke geometrisk samstilt for sammenligning.</p>
        </div>
        <Button variant="ghost" size="icon" className="shrink-0" aria-label="Lukk bildeavspilling" onClick={onClose}><X className="h-4 w-4" /></Button>
      </div>
      {unknownTimezone && <p className="text-xs text-fb-text-secondary">Bilder uten tidssone følger kameraets klokke; rekkefølge mellom tidssoner kan være usikker.</p>}
      <GlassSurface className="min-w-0 overflow-hidden p-2 sm:p-3">
        <div className="relative flex h-[min(48dvh,32rem)] min-h-40 w-full items-center justify-center overflow-hidden rounded-xl bg-black/80" aria-busy={!!photo && !loaded && !failed}>
          {photo && source && <img key={frameKey} src={source} alt={photo.title || `Bilde ${index + 1}`} className={`h-full w-full object-contain ${loaded ? "visible" : "invisible"}`} onLoad={(event) => { if (currentFrameKey.current === frameKey && event.currentTarget.naturalWidth > 0) setImageState({ key: frameKey, status: "loaded" }); }} onError={() => { if (currentFrameKey.current !== frameKey) return; setImageState({ key: frameKey, status: "error" }); setPlaying(false); }} />}
          {!photo ? <p className="p-4 text-center text-sm text-white">Ingen bilder med gyldig opptakstid i utvalget.</p> : failed ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center">
              <p role="alert" className="text-sm text-white">Bildet kunne ikke lastes. Avspillingen er satt på pause.</p>
              {source && <Button variant="secondary" onClick={() => { setPlaying(false); setRetry((value) => value + 1); }}><RotateCcw className="h-4 w-4" />Prøv bildet igjen</Button>}
            </div>
          ) : !loaded ? <p role="status" className="absolute p-4 text-sm text-white">Laster bilde {index + 1} …</p> : null}
        </div>
        {photo && <div className="mt-3 flex min-w-0 flex-wrap items-start justify-between gap-2 text-sm" aria-live="polite">
          <div className="min-w-0"><p className="font-medium">{formatCaptureTimestamp(photo.captured_at)}</p><p className="break-words text-xs text-fb-text-secondary">{photo.title}</p></div>
          <p className="shrink-0 tabular-nums">{index + 1} / {photos.length}</p>
        </div>}
      </GlassSurface>
      <div className="flex min-w-0 flex-wrap items-center justify-center gap-2">
        <Button variant="secondary" size="icon" aria-label="Forrige bilde" disabled={!photo || index === 0} onClick={() => navigate(-1)}><ChevronLeft className="h-5 w-5" /></Button>
        <Button variant="default" disabled={!photo || (!playing && (!loaded || atEnd))} onClick={() => setPlaying((value) => !value && !document.hidden)} aria-label={playing ? "Sett avspilling på pause" : "Spill bilder"}>
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}{playing ? "Pause" : "Spill"}
        </Button>
        <Button variant="secondary" size="icon" aria-label="Neste bilde" disabled={!photo || atEnd} onClick={() => navigate(1)}><ChevronRight className="h-5 w-5" /></Button>
        <label className="flex items-center gap-2 text-sm">Visningstid<NativeSelect value={seconds} onChange={(event) => setSeconds(Number(event.target.value))} aria-label="Visningstid per bilde"><option value={1}>1 sek</option><option value={2}>2 sek</option><option value={4}>4 sek</option></NativeSelect></label>
      </div>
      {photo && atEnd && <p role="status" className="text-center text-xs text-fb-text-secondary">Slutten av de innlastede bildene. Gå tilbake for å spille igjen.</p>}
      <div className="space-y-2 text-sm text-fb-text-secondary">
        {hasMore ? <p>{photos.length} innlastede bilder – utvalget er ikke komplett</p> : <p>{photos.length} bilder i avspillingen</p>}
        {excludedCount > 0 && <p>{excludedCount} bilder er utelatt fordi opptakstid mangler eller er ugyldig.</p>}
        {loadFailed && <p role="alert">Flere bilder kunne ikke lastes. Prøv igjen.</p>}
        {(hasMore || loadFailed) && <Button variant="secondary" loading={isLoadingMore} loadingLabel="Laster flere bilder" onClick={() => { setPlaying(false); onLoadMore(); }}>{loadFailed ? "Prøv å laste flere igjen" : "Last inn flere bilder"}</Button>}
        {isLoadingMore && <p role="status">Laster flere bilder …</p>}
      </div>
    </div>
  );
}
