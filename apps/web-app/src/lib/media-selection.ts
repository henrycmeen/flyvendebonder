export interface MediaImportFile {
  file: File;
  relativePath: string | null;
}

export interface MediaImportSelection {
  images: MediaImportFile[];
  videos: MediaImportFile[];
}

export interface StagedMediaItem extends MediaImportFile {
  id: string;
}

export function fromPickedFiles(files: File[]): MediaImportFile[] {
  return files.map((file) => ({
    file,
    relativePath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || null,
  }));
}

export function imageFileType(file: File): "JPEG" | "TIFF" | null {
  if (/\.(jpe?g)$/i.test(file.name)) return "JPEG";
  if (/\.(tiff?)$/i.test(file.name)) return "TIFF";
  return null;
}

export function stageMedia(current: StagedMediaItem[], incoming: MediaImportFile[]) {
  const items = [...current];
  const keys = new Set(items.map((item) => item.id));
  let duplicates = 0;
  let unsupported = 0;
  let empty = 0;
  let added = 0;
  for (const item of incoming) {
    if (!imageFileType(item.file)) { unsupported++; continue; }
    if (item.file.size === 0) { empty++; continue; }
    const relativePath = item.relativePath || null;
    const id = JSON.stringify([relativePath || item.file.name, item.file.size, item.file.lastModified]);
    if (keys.has(id)) { duplicates++; continue; }
    keys.add(id);
    items.push({ ...item, relativePath, id });
    added++;
  }
  return { items, added, duplicates, unsupported, empty };
}

export interface FileSystemEntryLike {
  name?: string;
  fullPath?: string;
  isFile?: boolean;
  isDirectory?: boolean;
  file?: (success: (file: File) => void, error?: (error: DOMException) => void) => void;
  createReader?: () => {
    readEntries: (success: (entries: FileSystemEntryLike[]) => void, error?: (error: DOMException) => void) => void;
  };
}

export interface DroppedMedia {
  files: MediaImportFile[];
  errors: string[];
}

export async function collectDroppedEntries(entries: FileSystemEntryLike[]): Promise<DroppedMedia> {
  const result: DroppedMedia = { files: [], errors: [] };
  async function visit(entry: FileSystemEntryLike, parentPath = "") {
    const path = entry.fullPath?.replace(/^\/+/, "") || [parentPath, entry.name].filter(Boolean).join("/");
    try {
      if (entry.isFile && entry.file) {
        const file = await new Promise<File>((resolve, reject) => entry.file!(resolve, reject));
        result.files.push({ file, relativePath: path || null });
      } else if (entry.isDirectory && entry.createReader) {
        const reader = entry.createReader();
        while (true) {
          const batch = await new Promise<FileSystemEntryLike[]>((resolve, reject) => reader.readEntries(resolve, reject));
          if (batch.length === 0) break;
          for (const child of batch) await visit(child, path);
        }
      } else {
        result.errors.push(path || "Ukjent fil");
      }
    } catch {
      result.errors.push(path || "Ukjent mappe eller fil");
    }
  }
  for (const entry of entries) await visit(entry);
  return result;
}

// Capture browser-owned transfer data before the first asynchronous directory read.
export async function extractDroppedMedia(transfer: DataTransfer): Promise<DroppedMedia> {
  const entries: FileSystemEntryLike[] = [];
  const fallback: File[] = [];
  const errors: string[] = [];
  const transferItems = Array.from(transfer.items || []).filter((item) => item.kind === "file");
  if (transferItems.length === 0) return { files: fromPickedFiles(Array.from(transfer.files)), errors };
  for (const item of transferItems) {
    try {
      const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntryLike | null }).webkitGetAsEntry?.();
      if (entry) entries.push(entry);
      else {
        const file = item.getAsFile();
        if (file) fallback.push(file);
        else errors.push("En fil eller mappe kunne ikke leses av nettleseren");
      }
    } catch { errors.push("En fil eller mappe kunne ikke leses av nettleseren"); }
  }
  const collected = await collectDroppedEntries(entries);
  return { files: [...collected.files, ...fromPickedFiles(fallback)], errors: [...errors, ...collected.errors] };
}
