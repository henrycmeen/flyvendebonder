import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { FolderOpen, ImagePlus, Loader2, UploadCloud } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/ui/layout-primitives";
import { cn } from "@/lib/utils";

export interface MediaImportFile {
  file: File;
  relativePath: string | null;
}

export interface MediaImportSelection {
  images: MediaImportFile[];
  videos: MediaImportFile[];
}

interface MediaImportPageProps {
  busy?: boolean;
  errorMessage?: string | null;
  disabledMessage?: string | null;
  onImport: (selection: MediaImportSelection) => Promise<boolean>;
}

type MediaKind = "image" | "video";

interface StagedMediaItem {
  id: string;
  file: File;
  kind: MediaKind;
  relativePath: string | null;
}

type FileSystemEntryLike = {
  isFile?: boolean;
  isDirectory?: boolean;
  file?: (success: (file: File) => void, error?: (error: DOMException) => void) => void;
  createReader?: () => {
    readEntries: (
      success: (entries: FileSystemEntryLike[]) => void,
      error?: (error: DOMException) => void,
    ) => void;
  };
};

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || /\.(jpe?g|tiff?)$/i.test(file.name);
}

function isVideoFile(file: File): boolean {
  return file.type.startsWith("video/") || /\.(mp4|mov|m4v|avi|mkv|webm|mpeg|mpg)$/i.test(file.name);
}

function buildFileKey(file: File): string {
  const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? "";
  return [file.name, file.size, file.lastModified, relativePath].join("::");
}

async function readAllDirectoryEntries(reader: ReturnType<NonNullable<FileSystemEntryLike["createReader"]>>): Promise<FileSystemEntryLike[]> {
  const allEntries: FileSystemEntryLike[] = [];
  while (true) {
    const batch = await new Promise<FileSystemEntryLike[]>((resolve) => {
      reader.readEntries((entries) => resolve(entries ?? []), () => resolve([]));
    });
    if (batch.length === 0) {
      return allEntries;
    }
    allEntries.push(...batch);
  }
}

async function collectFilesFromEntry(entry: FileSystemEntryLike | null | undefined): Promise<File[]> {
  if (!entry) return [];
  if (entry.isFile && typeof entry.file === "function") {
    const file = await new Promise<File | null>((resolve) => {
      entry.file?.((resolved) => resolve(resolved), () => resolve(null));
    });
    return file ? [file] : [];
  }

  if (entry.isDirectory && typeof entry.createReader === "function") {
    const reader = entry.createReader();
    const childEntries = await readAllDirectoryEntries(reader);
    const nested = await Promise.all(childEntries.map((child) => collectFilesFromEntry(child)));
    return nested.flat();
  }

  return [];
}

async function extractDroppedFiles(event: DragEvent<HTMLDivElement>): Promise<File[]> {
  const items = Array.from(event.dataTransfer.items ?? []);
  if (items.length === 0) {
    return Array.from(event.dataTransfer.files ?? []);
  }

  const supportsEntries = items.some(
    (item) =>
      typeof (item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntryLike | null }).webkitGetAsEntry ===
      "function",
  );
  if (!supportsEntries) {
    return Array.from(event.dataTransfer.files ?? []);
  }

  const nested = await Promise.all(
    items.map((item) => {
      const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntryLike | null }).webkitGetAsEntry?.() ?? null;
      return collectFilesFromEntry(entry);
    }),
  );
  return nested.flat();
}

function toStagedItems(files: File[]): StagedMediaItem[] {
  return files
    .filter((file) => isImageFile(file) || isVideoFile(file))
    .map((file) => {
      const kind: MediaKind = isImageFile(file) ? "image" : "video";
      const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? null;
      return {
        id: buildFileKey(file),
        file,
        kind,
        relativePath,
      };
    });
}

export function MediaImportPage({
  busy = false,
  errorMessage,
  disabledMessage,
  onImport,
}: MediaImportPageProps) {
  const [items, setItems] = useState<StagedMediaItem[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const folderInput = folderInputRef.current;
    if (folderInput) {
      folderInput.setAttribute("webkitdirectory", "");
      folderInput.setAttribute("directory", "");
    }
  }, []);

  const imageItems = useMemo(() => items.filter((item) => item.kind === "image"), [items]);
  const videoItems = useMemo(() => items.filter((item) => item.kind === "video"), [items]);
  const canStageMedia = !busy && !disabledMessage;

  const ingestFiles = (incomingFiles: File[]) => {
    if (!canStageMedia) return;
    if (incomingFiles.length === 0) return;

    const nextItems = toStagedItems(incomingFiles);
    if (nextItems.length === 0) return;

    setItems((current) => {
      const existingIds = new Set(current.map((item) => item.id));
      const freshItems = nextItems.filter((item) => !existingIds.has(item.id));
      return [...current, ...freshItems];
    });
  };

  const clearItems = () => {
    setItems([]);
  };

  const handleConfirmImport = async () => {
    if (disabledMessage || items.length === 0 || busy) return;
    const completed = await onImport({
      images: imageItems.map((item) => ({
        file: item.file,
        relativePath: item.relativePath,
      })),
      videos: videoItems.map((item) => ({
        file: item.file,
        relativePath: item.relativePath,
      })),
    });
    if (completed) {
      clearItems();
    }
  };

  return (
    <div className="pointer-events-auto absolute inset-0 z-[620] overflow-y-auto">
      <div className="min-h-full bg-fb-surface-base px-3 pb-8 pt-20 sm:px-6 sm:pt-6">
        <PageShell maxWidth="content" className="px-0">
          <div className="flex min-h-[calc(100vh-10rem)] items-center justify-center">
            <div className="w-full max-w-2xl space-y-4">
              <div
                className={cn(
                  "rounded-[32px] border border-fb-border-subtle bg-fb-surface-ghost p-4 shadow-fb-raised sm:p-6",
                  dragActive && canStageMedia && "border-[color:var(--fb-season-solid)] bg-[color:var(--fb-season-solid)]/6",
                )}
                onDragEnter={(event) => {
                  event.preventDefault();
                  if (!canStageMedia) return;
                  setDragActive(true);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (!canStageMedia) return;
                  setDragActive(true);
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  setDragActive(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragActive(false);
                  if (!canStageMedia) return;
                  void extractDroppedFiles(event).then((files) => {
                    ingestFiles(files);
                  });
                }}
              >
                <div className="flex min-h-[320px] flex-col items-center justify-center gap-6 rounded-[26px] border-2 border-dashed border-fb-border-subtle bg-fb-surface-base px-6 py-10 text-center sm:min-h-[360px] sm:px-10">
                  <UploadCloud className="h-10 w-10 text-fb-text-secondary" />
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <Button type="button" size="lg" onClick={() => folderInputRef.current?.click()} disabled={busy || Boolean(disabledMessage)}>
                      <FolderOpen className="mr-2 h-4 w-4" />
                      Velg mappe
                    </Button>
                    <Button type="button" size="lg" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={busy || Boolean(disabledMessage)}>
                      <ImagePlus className="mr-2 h-4 w-4" />
                      Velg filer
                    </Button>
                  </div>
                  {disabledMessage ? (
                    <p className="max-w-xl rounded-2xl border border-fb-border-subtle bg-fb-surface-ghost px-4 py-3 text-sm text-fb-text-secondary">
                      {disabledMessage}
                    </p>
                  ) : null}
                </div>
              </div>

              {items.length > 0 ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-fb-border-subtle bg-fb-surface-ghost px-4 py-3">
                  <p className="text-sm text-fb-text-secondary">{items.length} filer valgt</p>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="ghost" onClick={clearItems} disabled={busy}>
                      Tøm
                    </Button>
                    <Button type="button" onClick={() => void handleConfirmImport()} disabled={busy || Boolean(disabledMessage)}>
                      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Importer
                    </Button>
                  </div>
                </div>
              ) : null}

              {errorMessage ? (
                <p className="rounded-2xl border border-[color:var(--fb-accent-danger)]/45 bg-[color:var(--fb-accent-danger)]/8 px-4 py-3 text-sm text-fb-text-primary">
                  {errorMessage}
                </p>
              ) : null}
            </div>
          </div>

          <input
            ref={folderInputRef}
            type="file"
            className="hidden"
            multiple
            disabled={busy || Boolean(disabledMessage)}
            onChange={(event) => {
              ingestFiles(Array.from(event.currentTarget.files ?? []));
              event.currentTarget.value = "";
            }}
          />
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="image/*,video/*,.jpg,.jpeg,.tif,.tiff,.mp4,.mov,.m4v,.avi,.mkv,.webm"
            multiple
            disabled={busy || Boolean(disabledMessage)}
            onChange={(event) => {
              ingestFiles(Array.from(event.currentTarget.files ?? []));
              event.currentTarget.value = "";
            }}
          />
        </PageShell>
      </div>
    </div>
  );
}
