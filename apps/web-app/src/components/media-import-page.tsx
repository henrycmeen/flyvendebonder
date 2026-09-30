import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { FolderOpen, ImagePlus, Loader2, UploadCloud, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageShell } from "@/components/ui/layout-primitives";
import { extractDroppedMedia, fromPickedFiles, imageFileType, stageMedia, type MediaImportFile, type MediaImportSelection, type StagedMediaItem } from "@/lib/media-selection";
import { cn } from "@/lib/utils";

export type { MediaImportFile, MediaImportSelection } from "@/lib/media-selection";

interface MediaImportPageProps {
  receiptPanel?: ReactNode;
  busy?: boolean;
  errorMessage?: string | null;
  successMessage?: string | null;
  disabledMessage?: string | null;
  onImport: (selection: MediaImportSelection) => Promise<boolean>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 1 }).format(value)} ${units[unit]}`;
}

export function MediaImportPage({ receiptPanel, busy = false, errorMessage, successMessage, disabledMessage, onImport }: MediaImportPageProps) {
  const [items, setItems] = useState<StagedMediaItem[]>([]);
  const itemsRef = useRef<StagedMediaItem[]>([]);
  const operationRef = useRef(false);
  const [reading, setReading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [localNotice, setLocalNotice] = useState("");
  const [localError, setLocalError] = useState("");
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    folderInputRef.current?.setAttribute("webkitdirectory", "");
    folderInputRef.current?.setAttribute("directory", "");
  }, []);

  const locked = busy || reading || submitting || Boolean(disabledMessage);
  const updateItems = (next: StagedMediaItem[]) => { itemsRef.current = next; setItems(next); };
  const ingestFiles = (incoming: MediaImportFile[]) => {
    const result = stageMedia(itemsRef.current, incoming);
    updateItems(result.items);
    setLocalNotice([
      `${result.added} bildefiler lagt til.`,
      result.duplicates ? `${result.duplicates} duplikater hoppet over.` : "",
      result.unsupported ? `${result.unsupported} filer har et format som ikke støttes.` : "",
      result.empty ? `${result.empty} tomme filer hoppet over.` : "",
    ].filter(Boolean).join(" "));
  };

  const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    if (locked || operationRef.current) return;
    operationRef.current = true;
    setReading(true);
    setLocalError("");
    try {
      const result = await extractDroppedMedia(event.dataTransfer);
      ingestFiles(result.files);
      if (result.errors.length) {
        setLocalError(`${result.errors.length} filer eller mapper kunne ikke leses: ${result.errors.slice(0, 3).join(", ")}${result.errors.length > 3 ? " …" : ""}. Utvalget kan være ufullstendig. Velg disse på nytt før opplasting.`);
      }
    } catch {
      setLocalError("Kunne ikke lese filutvalget. Velg filene på nytt.");
    } finally {
      operationRef.current = false;
      setReading(false);
    }
  };

  const handleConfirmImport = async () => {
    if (locked || operationRef.current || itemsRef.current.length === 0) return;
    operationRef.current = true;
    setSubmitting(true);
    setLocalError("");
    try {
      const completed = await onImport({ images: itemsRef.current.map(({ file, relativePath }) => ({ file, relativePath })), videos: [] });
      if (completed) { updateItems([]); setLocalNotice(""); }
    } catch {
      setLocalError("Opplastingen kunne ikke fullføres. Filutvalget er beholdt, slik at du kan prøve igjen.");
    } finally { operationRef.current = false; setSubmitting(false); }
  };

  const pickerActions = (
    <>
      <Button type="button" onClick={() => folderInputRef.current?.click()} disabled={locked}><FolderOpen className="mr-2 h-4 w-4" />Velg mappe</Button>
      <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={locked}><ImagePlus className="mr-2 h-4 w-4" />Velg filer</Button>
    </>
  );

  return (
    <div className="pointer-events-auto absolute inset-0 z-[620] overflow-y-auto">
      <div className="min-h-full bg-fb-surface-base px-3 pb-8 pt-20 sm:px-6 sm:pt-6">
        <PageShell maxWidth="content" className="px-0">
          <div className="mx-auto w-full max-w-3xl space-y-5 py-6 sm:py-10">
            <header className="space-y-2 px-2">
              <h1 className="text-2xl font-semibold tracking-tight text-fb-text-primary">Import</h1>
              <p className="max-w-xl text-sm text-fb-text-secondary">Samle bilder fra dronefangsten og last opp til kontroll før import til biblioteket.</p>
              <p className="text-xs text-fb-text-secondary">Velg filer → Kontroller opplasting → Importer til bibliotek</p>
              <p className="text-xs text-fb-text-muted">JPG, JPEG, TIF og TIFF. Andre formater og tomme filer hoppes over.</p>
            </header>
            <div
              className={cn("rounded-[32px] border border-fb-border-subtle bg-fb-surface-ghost p-4 shadow-fb-raised sm:p-6", dragActive && !locked && "border-[color:var(--fb-season-solid)] bg-[color:var(--fb-season-solid)]/6")}
              aria-busy={reading || submitting || busy}
              onDragEnter={(event) => { event.preventDefault(); if (!locked) setDragActive(true); }}
              onDragOver={(event) => { event.preventDefault(); if (!locked) setDragActive(true); }}
              onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false); }}
              onDrop={(event) => void handleDrop(event)}
            >
              {items.length === 0 ? (
                <EmptyState className="min-h-[300px] rounded-[26px] border-2 bg-fb-surface-base px-6 py-10 sm:px-10" icon={<UploadCloud className="h-5 w-5" />} title="Velg bilder fra dronefangsten" description={disabledMessage || "Dra en mappe eller bildefiler hit, eller velg dem fra maskinen. Du kan se gjennom utvalget før opplasting."} actions={pickerActions} />
              ) : (
                <section aria-labelledby="selected-files-heading" className="space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div><h2 id="selected-files-heading" className="font-medium text-fb-text-primary">Valgte filer</h2><p className="mt-1 text-sm text-fb-text-secondary">{items.length} bilder · {formatBytes(items.reduce((sum, item) => sum + item.file.size, 0))}</p></div>
                    <div className="flex flex-wrap gap-2">{pickerActions}</div>
                  </div>
                  <ul className="max-h-[50vh] overflow-y-auto rounded-2xl border border-fb-border-subtle bg-fb-surface-base">
                    {items.map((item) => (
                      <li key={item.id} className="flex items-center gap-3 border-b border-fb-border-subtle px-4 py-3 last:border-b-0">
                        <div className="min-w-0 flex-1"><p className="break-words text-sm font-medium text-fb-text-primary">{item.file.name}</p><p className="mt-1 break-all text-xs text-fb-text-secondary">{item.relativePath || "Enkeltfil"}</p><p className="mt-1 text-xs text-fb-text-muted">{imageFileType(item.file)} · {formatBytes(item.file.size)}</p></div>
                        <Button type="button" size="icon" variant="ghost" aria-label={`Fjern ${item.relativePath || item.file.name}`} disabled={locked} onClick={() => { updateItems(itemsRef.current.filter((candidate) => candidate.id !== item.id)); setLocalNotice(`${item.file.name} fjernet fra utvalget.`); }}><X className="h-4 w-4" /></Button>
                      </li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-fb-text-secondary">Filene er valgt lokalt. Etter opplasting kontrollerer du dem før import til biblioteket.</p>
                    <div className="flex gap-2"><Button type="button" variant="ghost" disabled={locked} onClick={() => { updateItems([]); setLocalNotice("Filutvalget er tømt."); setLocalError(""); }}>Tøm utvalg</Button><Button type="button" disabled={locked} onClick={() => void handleConfirmImport()}>{busy || submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Last opp til kontroll</Button></div>
                  </div>
                </section>
              )}
            </div>
            <div role="status" aria-live="polite" aria-atomic="true" className="text-sm text-fb-text-secondary">
              {reading ? <p className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Leser filer og mapper …</p> : null}
              {busy || submitting ? <p>Laster opp valgte bilder til kontroll …</p> : null}
              {localNotice ? <p>{localNotice}</p> : null}
              {successMessage ? <p className="mt-2 text-fb-text-primary">{successMessage}</p> : null}
            </div>
            {disabledMessage && items.length > 0 ? <p className="text-sm text-fb-text-secondary">{disabledMessage}</p> : null}
            {localError || errorMessage ? <p role="alert" className="rounded-2xl border border-[color:var(--fb-accent-danger)]/45 bg-[color:var(--fb-accent-danger)]/8 px-4 py-3 text-sm text-fb-text-primary">{[localError, errorMessage].filter(Boolean).join(" ")}</p> : null}
          </div>
          {receiptPanel ? <div className="mx-auto w-full max-w-3xl pb-6">{receiptPanel}</div> : null}
          <input ref={folderInputRef} type="file" className="hidden" multiple disabled={locked} onChange={(event) => { if (!locked && !operationRef.current) { setLocalError(""); ingestFiles(fromPickedFiles(Array.from(event.currentTarget.files ?? []))); } event.currentTarget.value = ""; }} />
          <input ref={fileInputRef} type="file" className="hidden" accept="image/jpeg,image/tiff,.jpg,.jpeg,.tif,.tiff" multiple disabled={locked} onChange={(event) => { if (!locked && !operationRef.current) { setLocalError(""); ingestFiles(fromPickedFiles(Array.from(event.currentTarget.files ?? []))); } event.currentTarget.value = ""; }} />
        </PageShell>
      </div>
    </div>
  );
}
