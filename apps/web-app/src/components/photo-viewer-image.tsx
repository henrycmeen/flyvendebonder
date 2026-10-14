import { useRef, useState } from "react";
import { ImageOff, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

interface PhotoViewerImageProps {
  src: string;
  alt: string;
}

interface ImageAttemptProps extends PhotoViewerImageProps {
  onRetry: () => void;
}

function ImageAttempt({ src, alt, onRetry }: ImageAttemptProps) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const imageRef = useRef<HTMLImageElement>(null);

  return (
      <div className="photo-viewer-image-wrap relative h-full w-full">
        <img
          ref={imageRef}
          src={src}
          alt={alt}
          decoding="async"
          className={`photo-viewer-image h-full w-full object-contain ${status === "loaded" ? "" : "invisible"}`}
          onLoad={(event) => {
            if (event.currentTarget !== imageRef.current) return;
            const loaded = event.currentTarget.naturalWidth > 0;
            setStatus((current) => current === "loading" ? (loaded ? "loaded" : "error") : current);
          }}
          onError={(event) => {
            if (event.currentTarget !== imageRef.current) return;
            setStatus("error");
          }}
        />

        {status === "loading" ? (
          <div role="status" className="pointer-events-none absolute inset-0 flex items-center justify-center text-fb-text-secondary">
            <div className="flex items-center gap-2 rounded-xl border border-fb-border-subtle bg-fb-surface-base px-4 py-3">
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />
              <span className="text-sm">Laster bilde …</span>
            </div>
          </div>
        ) : null}

        {status === "error" ? (
          <div className="absolute inset-0 flex items-center justify-center bg-fb-surface-ghost text-center text-fb-text-secondary">
            <div className="max-w-xs px-6">
              <ImageOff aria-hidden="true" className="mx-auto mb-3 h-9 w-9 text-fb-text-muted" />
              <div role="alert">
                <p className="text-sm font-medium text-fb-text-primary">Bildet kunne ikke lastes</p>
                <p className="mt-1 text-xs leading-5">Prøv igjen, eller velg et annet bilde.</p>
              </div>
              <Button type="button" variant="outline" size="sm" className="mt-4" onClick={onRetry}>
                <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
                Prøv igjen
              </Button>
            </div>
          </div>
        ) : null}
      </div>
  );
}

function SourceImage(props: PhotoViewerImageProps) {
  const [attempt, setAttempt] = useState(0);

  // A fresh element makes retry a new image request and isolates old load/error events.
  return <ImageAttempt key={attempt} {...props} onRetry={() => setAttempt((current) => current + 1)} />;
}

export function PhotoViewerImage(props: PhotoViewerImageProps) {
  // Reset synchronously on a source change, including when returning to a previous photo.
  return <SourceImage key={props.src} {...props} />;
}
