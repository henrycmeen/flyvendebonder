import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Clock3, Loader2, Search, SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Divider, Grid, PageShell } from "@/components/ui/layout-primitives";
import { seasonLabel, splitCapturedDate } from "@/lib/formatters";
import { monthToSeason, type SeasonFilter } from "@/lib/season-theme";
import { cn } from "@/lib/utils";
import type { PhotoFeature } from "@/types";

interface AlbumPageProps {
  availableYears: string[];
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

type AlbumGridSize = "compact" | "standard" | "large";

const ALBUM_GRID_PRESETS = {
  compact: { cols: 2, smCols: 3, lgCols: 4, xlCols: 5 },
  standard: { cols: 2, smCols: 3, lgCols: 3, xlCols: 4 },
  large: { cols: 1, smCols: 2, lgCols: 2, xlCols: 3 },
} as const;

const SIZE_LABELS: Record<AlbumGridSize, string> = {
  compact: "Kompakt",
  standard: "Standard",
  large: "Store",
};

const SEASON_OPTIONS: SeasonFilter[] = ["all", "spring", "summer", "autumn", "winter"];

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

function normalizeSearchText(value: string | null | undefined): string {
  return (value ?? "").trim().toLocaleLowerCase("nb-NO");
}

export function AlbumPage({
  availableYears,
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
  const [selectedYear, setSelectedYear] = useState<string>("all");
  const [selectedSeason, setSelectedSeason] = useState<SeasonFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [gridSize, setGridSize] = useState<AlbumGridSize>("standard");
  const deferredSearchQuery = useDeferredValue(searchQuery);

  const sortedPhotos = useMemo(() => {
    return [...photos].sort((a, b) => {
      const diff = toTimestamp(b.captured_at) - toTimestamp(a.captured_at);
      if (diff !== 0) return diff;
      return b.id.localeCompare(a.id);
    });
  }, [photos]);

  const filteredPhotos = useMemo(() => {
    const normalizedSearch = normalizeSearchText(deferredSearchQuery);

    return sortedPhotos.filter((photo) => {
      const dateParts = splitCapturedDate(photo.captured_date);
      if (!dateParts) return false;
      if (selectedYear !== "all" && dateParts.year !== selectedYear) return false;
      if (selectedSeason !== "all" && monthToSeason(dateParts.month) !== selectedSeason) return false;

      if (!normalizedSearch) return true;

      const haystack = normalizeSearchText(
        [photo.title, photo.caption ?? "", photo.tags.join(" "), photo.captured_date].join(" "),
      );
      return haystack.includes(normalizedSearch);
    });
  }, [deferredSearchQuery, selectedSeason, selectedYear, sortedPhotos]);

  const groupedPhotos = useMemo<AlbumGroup[]>(() => {
    const groups = new Map<string, PhotoFeature[]>();

    filteredPhotos.forEach((photo) => {
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
  }, [filteredPhotos]);

  const visibleYears = useMemo(() => {
    const fromProps = availableYears.filter((year) => year && year !== "all");
    const fromLoadedPhotos = Array.from(
      new Set(
        sortedPhotos
          .map((photo) => splitCapturedDate(photo.captured_date)?.year ?? null)
          .filter((year): year is string => Boolean(year)),
      ),
    ).sort((a, b) => b.localeCompare(a));

    return Array.from(new Set([...fromProps, ...fromLoadedPhotos]));
  }, [availableYears, sortedPhotos]);

  const activeGridPreset = ALBUM_GRID_PRESETS[gridSize];
  const hasActiveFilters = selectedYear !== "all" || selectedSeason !== "all" || deferredSearchQuery.trim() !== "";

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
            <section className="sticky top-3 z-20 rounded-[24px] border border-fb-border-subtle/80 bg-fb-surface-base/95 px-3 py-3 shadow-[0_14px_34px_rgba(35,48,62,0.08)] backdrop-blur sm:px-4">
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-1">
                    <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-fb-text-muted">
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                      Album
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fb-text-secondary">
                      <span>{filteredPhotos.length} av {sortedPhotos.length} lastede bilder</span>
                      {hasMore ? <span>eldre sider lastes ved behov</span> : <span>hele albumet er lastet</span>}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium uppercase tracking-[0.2em] text-fb-text-muted">Størrelse</span>
                    <div className="inline-flex rounded-full border border-fb-border-subtle bg-fb-surface-ghost p-1">
                      {(Object.keys(SIZE_LABELS) as AlbumGridSize[]).map((size) => {
                        const isActive = gridSize === size;
                        return (
                          <button
                            key={size}
                            type="button"
                            className={cn(
                              "rounded-full px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fb-season-solid",
                              isActive
                                ? "bg-fb-interactive-default text-[color:var(--fb-chip-active-text)]"
                                : "text-fb-text-secondary hover:bg-fb-surface-base",
                            )}
                            onClick={() => setGridSize(size)}
                            aria-pressed={isActive}
                          >
                            {SIZE_LABELS[size]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
                  <label className="space-y-2">
                    <span className="text-xs font-medium uppercase tracking-[0.2em] text-fb-text-muted">Søk i album</span>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fb-text-muted" />
                      <Input
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        placeholder="Søk i tittel, notat, tagger eller dato"
                        className="pl-9"
                        aria-label="Søk i album"
                      />
                    </div>
                  </label>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <span className="text-xs font-medium uppercase tracking-[0.2em] text-fb-text-muted">År</span>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant={selectedYear === "all" ? "default" : "outline"}
                          onClick={() => setSelectedYear("all")}
                        >
                          Alle år
                        </Button>
                        {visibleYears.map((year) => (
                          <Button
                            key={year}
                            type="button"
                            size="sm"
                            variant={selectedYear === year ? "default" : "outline"}
                            onClick={() => setSelectedYear(year)}
                          >
                            {year}
                          </Button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <span className="text-xs font-medium uppercase tracking-[0.2em] text-fb-text-muted">Sesong</span>
                      <div className="flex flex-wrap gap-2">
                        {SEASON_OPTIONS.map((season) => (
                          <Button
                            key={season}
                            type="button"
                            size="sm"
                            variant={selectedSeason === season ? "default" : "outline"}
                            onClick={() => setSelectedSeason(season)}
                          >
                            {seasonLabel(season)}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

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
              <Grid
                cols={activeGridPreset.cols}
                smCols={activeGridPreset.smCols}
                lgCols={activeGridPreset.lgCols}
                xlCols={activeGridPreset.xlCols}
                gap={3}
              >
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

            {!isLoading && sortedPhotos.length > 0 && filteredPhotos.length === 0 && !loadFailed ? (
              <section className="rounded-2xl border border-dashed border-fb-border-subtle bg-fb-surface-ghost px-4 py-6 text-center">
                <div className="space-y-2">
                  <p className="text-sm font-medium text-fb-text-primary">Ingen bilder matcher filtrene akkurat nå.</p>
                  <p className="text-sm text-fb-text-secondary">
                    {hasMore
                      ? "Det kan fortsatt ligge treff i eldre sider som ikke er lastet inn ennå."
                      : "Prøv et annet år, en annen sesong eller et bredere søk."}
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                    {hasActiveFilters ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSelectedYear("all");
                          setSelectedSeason("all");
                          setSearchQuery("");
                        }}
                      >
                        Nullstill filter
                      </Button>
                    ) : null}
                    {hasMore ? (
                      <Button type="button" size="sm" onClick={onLoadMore} disabled={isLoadingMore}>
                        Last eldre bilder
                      </Button>
                    ) : null}
                  </div>
                </div>
              </section>
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
                <Grid
                  cols={activeGridPreset.cols}
                  smCols={activeGridPreset.smCols}
                  lgCols={activeGridPreset.lgCols}
                  xlCols={activeGridPreset.xlCols}
                  gap={3}
                >
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
