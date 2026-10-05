import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { GlassSurface } from "@/components/ui/glass-surface";
import type { MediaFinalizeResult, MediaStagingJob } from "@/types";

interface ImportReceiptsProps {
  jobs: MediaStagingJob[];
  selectedJob: MediaStagingJob | null;
  result: MediaFinalizeResult | null;
  loading: boolean;
  busy: boolean;
  onSelect: (jobId: string) => void;
  onRefresh: () => void;
  onFinalize: () => void;
}

const statuses: Record<string, string> = {
  staged: "Klar til kontroll", finalized: "Import behandlet", failed: "Feilet", rejected: "Avvist",
  imported: "Importert", skipped: "Hoppet over", created: "Opprettet", reused: "Gjenbrukt",
};

export function ImportReceipts({ jobs, selectedJob, result, loading, busy, onSelect, onRefresh, onFinalize }: ImportReceiptsProps) {
  const receiptResult = result ?? selectedJob?.finalize_result ?? null;
  const outcomeCounts = receiptResult ? { imported: receiptResult.items.filter((item) => item.status === "imported").length, failed: receiptResult.items.filter((item) => item.status === "failed").length, skipped: receiptResult.items.filter((item) => item.status === "skipped").length, rejected: receiptResult.items.filter((item) => item.status === "rejected").length } : null;
  const eligibleImages = selectedJob?.items.filter((item) => item.media_kind === "image" && item.status === "staged").length ?? 0;
  const hasVideos = selectedJob?.items.some((item) => item.media_kind === "video" && item.status === "staged") ?? false;
  return (
    <GlassSurface className="space-y-4 p-4 sm:p-6" aria-busy={loading || busy}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="font-medium">Kontroller opplasting</h2><p className="mt-1 text-sm text-fb-text-secondary">Opplastede filer beholdes på serveren. Velg en opplasting for å fortsette etter en ny åpning.</p></div>
        <Button variant="ghost" disabled={loading || busy} onClick={onRefresh} aria-label="Oppdater opplastinger"><RefreshCw className="mr-2 h-4 w-4" />Oppdater</Button>
      </header>
      {loading ? <p role="status" className="flex items-center gap-2 text-sm text-fb-text-secondary"><Loader2 className="h-4 w-4 animate-spin" />Henter opplastinger …</p> : null}
      {jobs.length > 0 ? (
        <div className="space-y-2"><label htmlFor="import-receipt-job" className="text-sm text-fb-text-secondary">Siste opplastinger</label><NativeSelect id="import-receipt-job" value={selectedJob?.job_id ?? ""} disabled={busy || loading} onChange={(event) => onSelect(event.target.value)} className="w-full rounded-xl border border-fb-border-subtle bg-fb-surface-base p-3 text-sm text-fb-text-primary"><option value="" disabled>Velg opplasting</option>{jobs.map((job) => <option key={job.job_id} value={job.job_id}>{new Date(job.created_at).toLocaleString("nb-NO")} · {job.counts.total} filer · {statuses[job.status] ?? `Ukjent status: ${job.status}`}</option>)}</NativeSelect></div>
      ) : !loading ? <p className="text-sm text-fb-text-secondary">Ingen tidligere opplastinger funnet.</p> : null}
      {selectedJob ? (
        <section className="space-y-3" aria-label="Opplastingskvittering">
          <p className="text-sm text-fb-text-secondary">{statuses[selectedJob.status] ?? `Ukjent status: ${selectedJob.status}`} · {selectedJob.counts.total} filer · {selectedJob.counts.rejected_count} avvist</p>
          {outcomeCounts ? <p className="text-sm text-fb-text-secondary">{outcomeCounts.imported} importert · {outcomeCounts.failed} feilet · {outcomeCounts.skipped} hoppet over · {outcomeCounts.rejected} avvist</p> : null}
          <p className="break-all text-xs text-fb-text-muted">Kvittering: {selectedJob.job_id}</p>
          <ul className="max-h-[45vh] overflow-y-auto rounded-xl border border-fb-border-subtle">
            {selectedJob.items.map((item) => {
              const outcome = receiptResult?.items.find((entry) => entry.staging_item_id === item.id);
              return <li key={item.id} className="space-y-1 border-b border-fb-border-subtle p-3 last:border-b-0"><p className="break-words text-sm font-medium">{item.filename}</p><p className="break-all text-xs text-fb-text-secondary">{item.source_path || "Enkeltfil"} · {new Intl.NumberFormat("nb-NO").format(item.bytes)} B</p><p className="text-xs text-fb-text-secondary">{outcome ? statuses[outcome.status] ?? `Ukjent status: ${outcome.status}` : item.status === "rejected" ? "Avvist ved opplasting" : selectedJob.status === "finalized" ? "Behandlet – serveren returnerte ikke detaljutfall for filen" : "Lastet opp, venter på import"}</p>{outcome?.detail || item.error_detail ? <p className="break-words text-xs text-fb-text-secondary">{outcome?.detail || item.error_detail}</p> : null}{outcome?.photo_id ? <p className="break-all text-xs text-fb-text-muted">Bilde-ID: {outcome.photo_id}</p> : null}</li>;
            })}
          </ul>
          {selectedJob.status === "staged" ? <>
            <p className="text-sm text-fb-text-secondary">{eligibleImages} bildefiler kan importeres. Avviste filer blir ikke lagt i biblioteket.</p>
            {hasVideos ? <p role="status" className="text-sm text-fb-text-secondary">Denne opplastingen inneholder video. Videoprosessering støttes ikke i denne bildeflyten.</p> : null}
            <Button disabled={busy || loading || eligibleImages === 0 || hasVideos} onClick={onFinalize}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Importer til bibliotek</Button>
          </> : selectedJob.status !== "finalized" ? <p role="status" className="text-sm text-fb-text-secondary">Opplastingen kunne ikke fullføres. Last opp filene på nytt.</p> : <p className="text-sm text-fb-text-secondary">Kvitteringen viser utfallet for hver fil. Bare importerte bilder er lagt i biblioteket.</p>}
        </section>
      ) : null}
    </GlassSurface>
  );
}
