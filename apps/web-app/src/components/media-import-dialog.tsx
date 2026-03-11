import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Clapperboard, FolderOpen, ImagePlus, Loader2, UploadCloud, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface MediaImportFile {
  file: File;
  relativePath: string | null;
}

export interface MediaImportSelection {
  images: MediaImportFile[];
  videos: MediaImportFile[];
}

interface MediaImportDialogProps {
  open: boolean;
  busy?: boolean;
  errorMessage?: string | null;
  onOpenChange: (nextOpen: boolean) => void;
  onImport: (selection: MediaImportSelection) => Promise<void>;
}

type MediaKind = "image" | "video";

interface StagedMediaItem {
  id: string;
  file: File;
  kind: MediaKind;
  previewUrl: string | null;
  label: string;
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

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const scaled = bytes / 1024 ** exponent;
  return `${scaled.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
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

  const supportsEntries = items.some((item) => typeof (item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntryLike | null }).webkitGetAsEntry === "function");
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
      const previewUrl = kind === "image" ? URL.createObjectURL(file) : null;
      const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? null;
      return {
        id: buildFileKey(file),
        file,
        kind,
        previewUrl,
        label: file.name,
        relativePath,
      };
    });
}

export function MediaImportDialog({
  open,
  busy = false,
  errorMessage,
  onOpenChange,
  onImport,
}: MediaImportDialogProps) {
  const [items, setItems] = useState<StagedMediaItem[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const itemsRef = useRef<StagedMediaItem[]>([]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    const folderInput = folderInputRef.current;
    if (folderInput) {
      folderInput.setAttribute("webkitdirectory", "");
      folderInput.setAttribute("directory", "");
    }

    return () => {
      itemsRef.current.forEach((item) => {
        if (item.previewUrl) {
          URL.revokeObjectURL(item.previewUrl);
        }
      });
    };
  }, []);

  const imageItems = useMemo(() => items.filter((item) => item.kind === "image"), [items]);
  const videoItems = useMemo(() => items.filter((item) => item.kind === "video"), [items]);

  const ingestFiles = (incomingFiles: File[]) => {
    if (incomingFiles.length === 0) return;

    const nextItems = toStagedItems(incomingFiles);
    if (nextItems.length === 0) return;

    setItems((current) => {
      const existingIds = new Set(current.map((item) => item.id));
      const freshItems = nextItems.filter((item) => !existingIds.has(item.id));
      return [...current, ...freshItems];
    });
  };

  const removeItem = (id: string) => {
    setItems((current) => {
      const target = current.find((item) => item.id === id);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return current.filter((item) => item.id !== id);
    });
  };

  const handleConfirmImport = async () => {
    if (items.length === 0 || busy) return;
    await onImport({
      images: imageItems.map((item) => ({
        file: item.file,
        relativePath: item.relativePath,
      })),
      videos: videoItems.map((item) => ({
        file: item.file,
        relativePath: item.relativePath,
      })),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (!busy ? onOpenChange(nextOpen) : undefined)}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Legg til media</DialogTitle>
          <DialogDescription>
            Dra inn en mappe eller filer med både bilder og video. Gå gjennom innholdet her før du importerer.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <input
            ref={folderInputRef}
            type="file"
            className="hidden"
            multiple
            onChange={(event) => {
              ingestFiles(Array.from(event.currentTarget.files ?? []));
            }}
          />
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="image/*,video/*,.jpg,.jpeg,.tif,.tiff,.mp4,.mov,.m4v,.avi,.mkv,.webm"
            multiple
            onChange={(event) => {
              ingestFiles(Array.from(event.currentTarget.files ?? []));
            }}
          />

          <div
            className={cn(
              "rounded-2xl border-2 border-dashed border-fb-border-subtle bg-fb-surface-base p-6 text-center transition-colors",
              dragActive && "border-[color:var(--fb-season-solid)] bg-[color:var(--fb-season-solid)]/5",
            )}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              setDragActive(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              void extractDroppedFiles(event).then((files) => {
                ingestFiles(files);
              });
            }}
          >
            <UploadCloud className="mx-auto h-8 w-8 text-fb-text-secondary" />
            <p className="mt-2 text-sm text-fb-text-primary">Slipp mappe eller filer her</p>
            <p className="text-xs text-fb-text-secondary">Støtter blandede mapper med både stillbilder og video.</p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <Button type="button" variant="outline" onClick={() => folderInputRef.current?.click()} disabled={busy}>
                <FolderOpen className="mr-2 h-4 w-4" />
                Velg mappe
              </Button>
              <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={busy}>
                <ImagePlus className="mr-2 h-4 w-4" />
                Velg filer
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 text-xs text-fb-text-secondary">
            <span className="rounded-full border border-fb-border-subtle px-2 py-0.5">{items.length} filer klare</span>
            <span className="rounded-full border border-fb-border-subtle px-2 py-0.5">{imageItems.length} bilder</span>
            <span className="rounded-full border border-fb-border-subtle px-2 py-0.5">{videoItems.length} videoer</span>
          </div>

          {videoItems.length > 1 ? (
            <p className="rounded-lg border border-fb-border-subtle bg-fb-surface-ghost px-3 py-2 text-xs text-fb-text-secondary">
              Flere videoer er valgt. Første video startes i denne versjonen, mens bildene fortsatt importeres samlet.
            </p>
          ) : null}

          {errorMessage ? (
            <p className="rounded-lg border border-[color:var(--fb-accent-danger)]/45 bg-[color:var(--fb-accent-danger)]/8 px-3 py-2 text-sm text-fb-text-primary">
              {errorMessage}
            </p>
          ) : null}

          {items.length > 0 ? (
            <div className="max-h-[48vh] overflow-y-auto rounded-2xl border border-fb-border-subtle bg-fb-surface-base p-3">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {items.map((item) => (
                  <article key={item.id} className="overflow-hidden rounded-xl border border-fb-border-subtle bg-fb-surface-ghost">
                    {item.kind === "image" && item.previewUrl ? (
                      <img src={item.previewUrl} alt={item.label} className="h-32 w-full object-cover" />
                    ) : (
                      <div className="flex h-32 items-center justify-center bg-fb-surface-base text-fb-text-secondary">
                        <Clapperboard className="h-8 w-8" />
                      </div>
                    )}
                    <div className="space-y-1 px-3 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-fb-text-primary">{item.label}</p>
                          <p className="text-xs text-fb-text-secondary">{item.kind === "image" ? "Bilde" : "Video"} · {formatBytes(item.file.size)}</p>
                        </div>
                        <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => removeItem(item.id)} disabled={busy}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                      {item.relativePath ? (
                        <p className="truncate text-[11px] text-fb-text-secondary">{item.relativePath}</p>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ) : (
            <p className="rounded-lg border border-fb-border-subtle bg-fb-surface-ghost px-3 py-2 text-sm text-fb-text-secondary">
              Ingen media valgt ennå.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Avbryt
          </Button>
          <Button type="button" onClick={() => void handleConfirmImport()} disabled={busy || items.length === 0}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Importer valgte medier
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
