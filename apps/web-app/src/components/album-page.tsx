import { useEffect, useMemo, useRef } from "react";
import { CalendarDays, Clock3, Images, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
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
      const diff = toTimestamp(a.captured_at) - toTimestamp(b.captured_at);
      if (diff !== 0) return diff;
      return a.id.localeCompare(b.id);
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
      <div className="min-h-full bg-[#fcfcfa] pb-8 pl-[74px] pr-3 pt-3 sm:pl-[86px] sm:pr-6 sm:pt-4">
        <div className="mx-auto max-w-[1360px]">
          <div className="space-y-5 rounded-[24px] border border-[#e8e4dc] bg-white/96 p-3 shadow-[0_18px_34px_rgba(25,28,34,0.06)] sm:p-4">
          <section className="rounded-2xl border border-[#e6e2da] bg-white px-4 py-3 shadow-[0_2px_12px_rgba(17,24,39,0.05)] sm:px-5 sm:py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex items-center gap-2">
                <Images className="h-5 w-5 text-[#5f646d]" />
                <h1 className="text-lg font-semibold text-[#141821]">Album</h1>
              </div>
              <p className="text-sm text-[#5f646d]">
                {sortedPhotos.length} bilder · kronologisk (eldst til nyest)
              </p>
            </div>
          </section>

          {loadFailed ? (
            <section className="rounded-2xl border border-red-300/70 bg-white px-4 py-3 text-sm text-red-900">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p>Kunne ikke laste albumdata akkurat nå.</p>
                <Button type="button" size="sm" variant="outline" onClick={onLoadMore}>
                  Prøv igjen
                </Button>
              </div>
            </section>
          ) : null}

          {isLoading && sortedPhotos.length === 0 ? (
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {Array.from({ length: 10 }).map((_, index) => (
                <div key={index} className="overflow-hidden rounded-xl border border-[#ece8e2] bg-white">
                  <div className="aspect-[4/5] animate-pulse bg-[#f1efea]" />
                </div>
              ))}
            </section>
          ) : null}

          {!isLoading && sortedPhotos.length === 0 && !loadFailed ? (
            <section className="rounded-2xl border border-[#ece8e2] bg-white px-4 py-6 text-center text-[#5f646d]">
              Ingen bilder å vise i album enda.
            </section>
          ) : null}

          {groupedPhotos.map((group) => (
            <section key={group.key} className="space-y-2 rounded-2xl border border-[#ece8e2] bg-white p-3 sm:p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold capitalize text-[#1f2937]">{group.label}</h2>
                <p className="text-xs text-[#6b7280]">{group.photos.length} bilder</p>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {group.photos.map((photo) => (
                  <button
                    key={photo.id}
                    type="button"
                    className="group overflow-hidden rounded-xl border border-[#e9e5df] bg-white text-left transition-all hover:-translate-y-0.5 hover:shadow-[0_10px_24px_rgba(17,24,39,0.10)]"
                    onClick={() => onOpenPhoto(photo.id)}
                    aria-label={`Åpne ${photo.title || "foto"} i fullskjerm`}
                  >
                    {photo.thumbnail_url || photo.image_url ? (
                      <img
                        src={photo.thumbnail_url || photo.image_url || ""}
                        alt={photo.title || "Foto"}
                        loading="lazy"
                        decoding="async"
                        className="aspect-[4/5] w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                      />
                    ) : (
                      <div className="aspect-[4/5] w-full bg-[#f1efea]" />
                    )}

                    <div className="space-y-1 px-2.5 py-2">
                      <p className="line-clamp-1 text-sm font-medium text-[#1f2937]">{photo.title || "Foto"}</p>
                      <div className="flex items-center justify-between gap-2 text-[11px] text-[#6b7280]">
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
              </div>
            </section>
          ))}

          <section className="pb-2 pt-1">
            <div ref={sentinelRef} className="h-1 w-full" aria-hidden="true" />

            {isLoadingMore ? (
              <div className="flex items-center justify-center gap-2 text-sm text-[#5f646d]">
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
        </div>
      </div>
    </div>
  );
}
