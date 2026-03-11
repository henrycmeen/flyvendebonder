import { useEffect, useMemo, useRef } from "react";
import { CalendarDays, Clock3, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Divider, Grid, PageShell } from "@/components/ui/layout-primitives";
import type { PhotoFeature } from "@/types";

interface AlbumPageProps {
  photos: PhotoFeature[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  loadFailed: boolean;
  onLoadMore: () => void;
  onOpenPhoto: (photoId: string) => void;
  onScrollActivity?: () => void;
}

interface AlbumGroup {
  key: string;
  label: string;
  photos: PhotoFeature[];
}

function toTimestamp(value: string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return 0;
  return parsed;
}

function formatMonthLabel(value: string): string {
  const asDate = new Date(`${value}-01T00:00:00`);
  return asDate.toLocaleDateString("nb-NO", {
    month: "long",
    year: "numeric",
  });
}

function formatDayLabel(value: string): string {
  const asDate = new Date(`${value}T00:00:00`);
  return asDate.toLocaleDateString("nb-NO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatTimeLabel(value: string): string {
  const asDate = new Date(value);
  return asDate.toLocaleTimeString("nb-NO", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function AlbumPage({
  photos,
  isLoading,
  isLoadingMore,
  hasMore,
  loadFailed,
  onLoadMore,
  onOpenPhoto,
  onScrollActivity,
}: AlbumPageProps) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const sortedPhotos = useMemo(() => {
    return [...photos].sort((a, b) => {
      const diff = toTimestamp(b.captured_at) - toTimestamp(a.captured_at);
      if (diff !== 0) return diff;
      return b.id.localeCompare(a.id);
    });
  }, [photos]);

  const groupedPhotos = useMemo<AlbumGroup[]>(() => {
    const groups = new Map<string, PhotoFeature[]>();

    sortedPhotos.forEach((photo) => {
      const key = photo.captured_date.slice(0, 7);
      const existing = groups.get(key);
      if (existing) {
        existing.push(photo);
      } else {
        groups.set(key, [photo]);
      }
    });

    return Array.from(groups.entries()).map(([key, items]) => ({
      key,
      label: formatMonthLabel(key),
      photos: items,
    }));
  }, [sortedPhotos]);

  useEffect(() => {
    if (!hasMore || isLoading || isLoadingMore || loadFailed) return;
    if (!sentinelRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onLoadMore();
        }
      },
      { rootMargin: "240px 0px" },
    );

    observer.observe(sentinelRef.current);
    return () => {
      observer.disconnect();
    };
  }, [hasMore, isLoading, isLoadingMore, loadFailed, onLoadMore]);

  return (
    <div
      className="pointer-events-auto absolute inset-0 z-[620] overflow-y-auto"
      onScroll={() => {
        onScrollActivity?.();
      }}
    >
      <div className="min-h-full bg-fb-surface-base px-3 pb-8 pt-20 sm:px-6 sm:pt-6">
        <PageShell maxWidth="wide" className="px-0">
          <div className="space-y-5 pb-4">
            {loadFailed ? (
            <section className="flex flex-wrap items-center justify-between gap-3 text-sm text-fb-text-primary">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p>Kunne ikke laste albumdata akkurat nå.</p>
                <Button type="button" size="sm" variant="outline" onClick={onLoadMore}>
                  Prøv igjen
                </Button>
              </div>
            </section>
          ) : null}

            {isLoading && sortedPhotos.length === 0 ? (
              <Grid cols={2} smCols={3} lgCols={4} xlCols={5} gap={3}>
              {Array.from({ length: 10 }).map((_, index) => (
                <div key={index} className="overflow-hidden rounded-xl border border-fb-border-subtle bg-fb-surface-ghost">
                  <div className="aspect-[4/5] animate-pulse bg-fb-surface-base" />
                </div>
              ))}
              </Grid>
            ) : null}

            {!isLoading && sortedPhotos.length === 0 && !loadFailed ? (
              <section className="py-6 text-center text-fb-text-secondary">Ingen bilder å vise i album enda.</section>
            ) : null}

            {groupedPhotos.map((group, index) => (
              <section
                key={group.key}
                className={index === 0 ? "space-y-3" : "space-y-3 border-t border-fb-border-subtle/60 pt-5"}
              >
                <header className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-semibold capitalize text-fb-text-primary">{group.label}</h2>
                  <p className="text-xs text-fb-text-muted">{group.photos.length} bilder</p>
                </header>
                <Grid cols={2} smCols={3} lgCols={4} xlCols={5} gap={3}>
                {group.photos.map((photo) => (
                  <button
                    key={photo.id}
                    type="button"
                    className="group fb-card-hover overflow-hidden rounded-xl border border-fb-border-subtle bg-fb-surface-ghost text-left transition-[transform,box-shadow,filter] duration-[var(--fb-motion-duration-micro)] ease-[var(--fb-motion-easing-standard)]"
                    onClick={() => onOpenPhoto(photo.id)}
                    aria-label={`Åpne ${photo.title || "foto"} i fullskjerm`}
                  >
                    {photo.thumbnail_url || photo.image_url ? (
                      <img
                        src={photo.thumbnail_url || photo.image_url || ""}
                        alt={photo.title || "Foto"}
                        loading="lazy"
                        decoding="async"
                        className="aspect-[4/5] w-full object-cover transition-transform duration-[var(--fb-motion-duration-small)] ease-[var(--fb-motion-easing-standard)] group-hover:scale-[1.02]"
                      />
                    ) : (
                      <div className="aspect-[4/5] w-full bg-fb-surface-base" />
                    )}

                    <div className="space-y-1 px-2.5 py-2">
                      <p className="line-clamp-1 text-sm font-medium text-fb-text-primary">{photo.title || "Foto"}</p>
                      <div className="flex items-center justify-between gap-2 text-[11px] text-fb-text-muted">
                        <span className="inline-flex items-center gap-1">
                          <CalendarDays className="h-3 w-3" />
                          {formatDayLabel(photo.captured_date)}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Clock3 className="h-3 w-3" />
                          {formatTimeLabel(photo.captured_at)}
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
                </Grid>
              </section>
            ))}

            <section className="pb-2 pt-1">
              <Divider className="mb-3" />
              <div ref={sentinelRef} className="h-1 w-full" aria-hidden="true" />

              {isLoadingMore ? (
                <div className="flex items-center justify-center gap-2 text-sm text-fb-text-secondary">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Laster flere bilder ...
                </div>
              ) : null}

              {!isLoadingMore && hasMore ? (
                <div className="flex justify-center">
                  <Button type="button" variant="outline" onClick={onLoadMore}>
                    Last flere
                  </Button>
                </div>
              ) : null}
            </section>
          </div>
        </PageShell>
      </div>
    </div>
  );
}
