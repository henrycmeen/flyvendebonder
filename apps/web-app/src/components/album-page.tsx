import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Clock3, Images, Loader2, Search, SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { GlassSurface } from "@/components/ui/glass-surface";
import { NativeSelect } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";
import { Divider, Grid, PageShell } from "@/components/ui/layout-primitives";
import { splitCapturedDate } from "@/lib/formatters";
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

const ALBUM_GRID_PRESET = { cols: 2, smCols: 3, lgCols: 3, xlCols: 4 } as const;
const UNKNOWN_DATE_GROUP_KEY = "unknown-date";
const SUGGESTED_SEASON_TOKENS = [
  { token: "#vår", label: "Vår" },
  { token: "#sommer", label: "Sommer" },
  { token: "#høst", label: "Høst" },
  { token: "#vinter", label: "Vinter" },
] as const;
const SEASON_TOKEN_MAP: Record<string, SeasonFilter> = {
  var: "spring",
  vaar: "spring",
  vår: "spring",
  spring: "spring",
  sommer: "summer",
  summer: "summer",
  host: "autumn",
  høst: "autumn",
  autumn: "autumn",
  fall: "autumn",
  vinter: "winter",
  winter: "winter",
};

function toTimestamp(value: string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return 0;
  return parsed;
}

function formatMonthLabel(value: string): string {
  if (value === UNKNOWN_DATE_GROUP_KEY) {
    return "Ukjent dato";
  }
  const asDate = new Date(`${value}-01T00:00:00`);
  if (Number.isNaN(asDate.getTime())) {
    return "Ukjent dato";
  }
  return asDate.toLocaleDateString("nb-NO", {
    month: "long",
    year: "numeric",
  });
}

function formatDayLabel(value: string): string {
  const asDate = new Date(`${value}T00:00:00`);
  if (Number.isNaN(asDate.getTime())) {
    return "Ukjent dato";
  }
  return asDate.toLocaleDateString("nb-NO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatTimeLabel(value: string): string {
  const asDate = new Date(value);
  if (Number.isNaN(asDate.getTime())) {
    return "Ukjent tid";
  }
  return asDate.toLocaleTimeString("nb-NO", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function normalizeSearchText(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLocaleLowerCase("nb-NO")
    .replaceAll("æ", "ae")
    .replaceAll("ø", "o")
    .replaceAll("å", "a");
}

function splitQueryTokens(value: string): string[] {
  return value
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function normalizeQueryToken(value: string): string {
  return normalizeSearchText(value)
    .replace(/^#+/, "")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

function parseAlbumQuery(value: string): {
  textTokens: string[];
  yearTokens: Set<string>;
  seasonTokens: Set<SeasonFilter>;
} {
  const textTokens: string[] = [];
  const yearTokens = new Set<string>();
  const seasonTokens = new Set<SeasonFilter>();

  splitQueryTokens(value).forEach((token) => {
    const normalizedToken = normalizeQueryToken(token);
    if (!normalizedToken) return;

    if (/^\d{4}$/.test(normalizedToken)) {
      yearTokens.add(normalizedToken);
      return;
    }

    const season = SEASON_TOKEN_MAP[normalizedToken];
    if (season) {
      seasonTokens.add(season);
      return;
    }

    textTokens.push(normalizedToken);
  });

  return { textTokens, yearTokens, seasonTokens };
}

function albumGroupKey(photo: PhotoFeature): string {
  const dateParts = splitCapturedDate(photo.captured_date);
  if (!dateParts) return UNKNOWN_DATE_GROUP_KEY;
  return `${dateParts.year}-${dateParts.month}`;
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
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [qualityFilter, setQualityFilter] = useState<"all" | "review" | "checked">("all");
  const [groupBy, setGroupBy] = useState<"day" | "month">("day");
  const deferredSearchQuery = useDeferredValue(searchQuery);

  const sortedPhotos = useMemo(() => {
    return [...photos].sort((a, b) => {
      const diff = toTimestamp(b.captured_at) - toTimestamp(a.captured_at);
      if (diff !== 0) return sortOrder === "newest" ? diff : -diff;
      return sortOrder === "newest" ? b.id.localeCompare(a.id) : a.id.localeCompare(b.id);
    });
  }, [photos, sortOrder]);

  const parsedQuery = useMemo(() => parseAlbumQuery(deferredSearchQuery), [deferredSearchQuery]);

  const filteredPhotos = useMemo(() => {
    return sortedPhotos.filter((photo) => {
      if (qualityFilter === "review" && !photo.needs_manual_qc) return false;
      if (qualityFilter === "checked" && photo.needs_manual_qc) return false;
      const dateParts = splitCapturedDate(photo.captured_date);
      if (parsedQuery.yearTokens.size > 0 && (!dateParts || !parsedQuery.yearTokens.has(dateParts.year))) return false;
      if (parsedQuery.seasonTokens.size > 0 && (!dateParts || !parsedQuery.seasonTokens.has(monthToSeason(dateParts.month)))) return false;
      if (parsedQuery.textTokens.length === 0) return true;

      const haystack = normalizeSearchText(
        [photo.title, photo.caption ?? "", photo.tags.join(" "), photo.captured_date].join(" "),
      );
      return parsedQuery.textTokens.every((token) => haystack.includes(token));
    });
  }, [parsedQuery, sortedPhotos, qualityFilter]);

  const groupedPhotos = useMemo<AlbumGroup[]>(() => {
    const groups = new Map<string, PhotoFeature[]>();

    filteredPhotos.forEach((photo) => {
      const key = groupBy === "day" && splitCapturedDate(photo.captured_date) ? photo.captured_date : albumGroupKey(photo);
      const existing = groups.get(key);
      if (existing) {
        existing.push(photo);
      } else {
        groups.set(key, [photo]);
      }
    });

    return Array.from(groups.entries()).map(([key, items]) => ({
      key,
      label: groupBy === "day" && key !== UNKNOWN_DATE_GROUP_KEY ? new Date(`${key}T12:00:00`).toLocaleDateString("nb-NO", {day: "numeric", month: "long", year: "numeric"}) : formatMonthLabel(key),
      photos: items,
    }));
  }, [filteredPhotos, groupBy]);

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

  const hasActiveFilters = deferredSearchQuery.trim() !== "" || qualityFilter !== "all";
  const visibleSuggestions = isSearchFocused || hasActiveFilters;
  const suggestedYears = visibleYears.slice(0, 4);

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

  const toggleQueryToken = (token: string) => {
    setSearchQuery((current) => {
      const existingTokens = splitQueryTokens(current);
      const normalizedToken = normalizeQueryToken(token);
      const remainingTokens = existingTokens.filter((existingToken) => normalizeQueryToken(existingToken) !== normalizedToken);

      if (remainingTokens.length !== existingTokens.length) {
        return remainingTokens.join(" ");
      }

      return [...remainingTokens, token].join(" ").trim();
    });
  };

  const queryHasToken = (token: string) =>
    splitQueryTokens(searchQuery).some((existingToken) => normalizeQueryToken(existingToken) === normalizeQueryToken(token));

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
            <header className="flex flex-wrap items-end justify-between gap-4 py-3">
              <div>
                <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-fb-text-secondary"><Images className="h-4 w-4" /> Gårdens opptak</p>
                <h1 className="text-3xl font-semibold tracking-tight text-fb-text-primary sm:text-4xl">Mediebibliotek</h1>
                <p className="mt-2 max-w-lg text-sm leading-relaxed text-fb-text-secondary">Bilder, opptaksdatoer og kvalitet samlet. Åpne et bilde for å undersøke posisjon og metadata.</p>
              </div>
              <div className="rounded-2xl border border-fb-border-subtle bg-fb-surface-ghost px-4 py-3 text-sm" role="status">
                <strong>{photos.length.toLocaleString("nb-NO")}</strong> bilder lastet
                <span className="mt-1 block text-xs text-fb-text-secondary">{hasMore ? "Eldre opptak lastes videre nedenfor" : "Alle tilgjengelige bilder er lastet"}</span>
              </div>
            </header>
            <GlassSurface surface="floating" className="sticky top-3 z-20 px-3 py-3 sm:px-4">
              <div className="space-y-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fb-text-muted" />
                  <Input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    onFocus={() => setIsSearchFocused(true)}
                    onBlur={() => setIsSearchFocused(false)}
                    placeholder="Søk etter filnavn, dato, sesong eller tagg"
                    className="rounded-xl border-transparent bg-fb-surface-ghost pl-9 shadow-none focus-visible:ring-1"
                    aria-label="Søk i mediebibliotek"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-3 border-t border-fb-border-subtle pt-3">
                  <SlidersHorizontal className="h-4 w-4 text-fb-text-muted" aria-hidden="true" />
                  <label className="flex items-center gap-2 text-xs text-fb-text-secondary">Kvalitet
                    <NativeSelect value={qualityFilter} onChange={(event) => setQualityFilter(event.target.value as typeof qualityFilter)}>
                      <option value="all">Alle bilder</option><option value="review">Må vurderes</option><option value="checked">Uten manuell QC</option>
                    </NativeSelect>
                  </label>
                  <label className="flex items-center gap-2 text-xs text-fb-text-secondary">Sorter
                    <NativeSelect value={sortOrder} onChange={(event) => setSortOrder(event.target.value as typeof sortOrder)}>
                      <option value="newest">Nyeste først</option><option value="oldest">Eldste først</option>
                    </NativeSelect>
                  </label>
                  <label className="flex items-center gap-2 text-xs text-fb-text-secondary">Grupper
                    <NativeSelect value={groupBy} onChange={(event) => setGroupBy(event.target.value as typeof groupBy)}>
                      <option value="day">Opptaksdato</option><option value="month">Måned</option>
                    </NativeSelect>
                  </label>
                  <span className="text-xs text-fb-text-secondary">{filteredPhotos.length.toLocaleString("nb-NO")} treff blant lastede bilder</span>
                  {hasActiveFilters ? <Button type="button" size="sm" variant="ghost" onClick={() => {setSearchQuery(""); setQualityFilter("all");}}>Nullstill</Button> : null}
                </div>
                {visibleSuggestions ? (
                  <div className="space-y-2 rounded-[20px] border border-fb-border-subtle bg-fb-surface-ghost/80 px-3 py-3">
                    <p className="text-xs text-fb-text-secondary">
                      Legg til år eller sesong som fritekst eller hashtag, for eksempel <span className="font-medium text-fb-text-primary">2025 høst</span> eller <span className="font-medium text-fb-text-primary">#2025 #høst</span>.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {suggestedYears.map((year) => {
                        const token = `#${year}`;
                        const isActive = queryHasToken(token);
                        return (
                          <button
                            key={token}
                            type="button"
                            className={cn(
                              "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fb-season-solid",
                              isActive
                                ? "border-transparent bg-fb-interactive-default text-[color:var(--fb-chip-active-text)]"
                                : "border-fb-border-subtle bg-fb-surface-base text-fb-text-secondary hover:bg-fb-surface-elevated",
                            )}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => toggleQueryToken(token)}
                            aria-pressed={isActive}
                          >
                            {token}
                          </button>
                        );
                      })}
                      {SUGGESTED_SEASON_TOKENS.map(({ token, label }) => {
                        const isActive = queryHasToken(token);
                        return (
                          <button
                            key={token}
                            type="button"
                            className={cn(
                              "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fb-season-solid",
                              isActive
                                ? "border-transparent bg-fb-interactive-default text-[color:var(--fb-chip-active-text)]"
                                : "border-fb-border-subtle bg-fb-surface-base text-fb-text-secondary hover:bg-fb-surface-elevated",
                            )}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => toggleQueryToken(token)}
                            aria-pressed={isActive}
                          >
                            {token} <span className="text-fb-text-muted">{label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            </GlassSurface>

            {loadFailed ? (
              <section className="flex flex-wrap items-center justify-between gap-3 text-sm text-fb-text-primary">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p>Kunne ikke laste biblioteket akkurat nå.</p>
                  <Button type="button" size="sm" variant="outline" onClick={onLoadMore} disabled={isLoading || isLoadingMore}>
                    Prøv igjen
                  </Button>
                </div>
              </section>
            ) : null}

            {isLoading && sortedPhotos.length === 0 ? (
              <Grid
                cols={ALBUM_GRID_PRESET.cols}
                smCols={ALBUM_GRID_PRESET.smCols}
                lgCols={ALBUM_GRID_PRESET.lgCols}
                xlCols={ALBUM_GRID_PRESET.xlCols}
                gap={3}
              >
                {Array.from({ length: 10 }).map((_, index) => (
                  <div key={index} className="overflow-hidden rounded-xl border border-fb-border-subtle bg-fb-surface-ghost">
                    <div className="aspect-[4/3] animate-pulse bg-fb-surface-base" />
                  </div>
                ))}
              </Grid>
            ) : null}

            {!isLoading && sortedPhotos.length === 0 && !loadFailed ? (
              <EmptyState
                className="min-h-[220px]"
                icon={<CalendarDays className="h-5 w-5" />}
                title="Biblioteket er tomt"
                description="Biblioteket viser importerte bilder etter opptaksdato. Gå til Import når første bildefangst skal inn."
              />
            ) : null}

            {!isLoading && sortedPhotos.length > 0 && filteredPhotos.length === 0 && !loadFailed ? (
              <EmptyState
                className="min-h-[220px]"
                icon={<Search className="h-5 w-5" />}
                title="Ingen bilder matcher filtrene"
                description={
                  hasMore
                    ? "Det kan fortsatt ligge treff i eldre albumsider som ikke er lastet inn ennå."
                    : "Prøv et annet søk, eller fjern år- og sesongord som 2025 og høst."
                }
                actions={
                  <>
                    {hasActiveFilters ? (
                      <Button type="button" size="sm" variant="outline" onClick={() => { setSearchQuery(""); setQualityFilter("all"); }}>
                        Nullstill filter
                      </Button>
                    ) : null}
                    {hasMore ? (
                      <Button type="button" size="sm" onClick={onLoadMore} disabled={isLoadingMore}>
                        Last flere opptak
                      </Button>
                    ) : null}
                  </>
                }
              />
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
                  cols={ALBUM_GRID_PRESET.cols}
                  smCols={ALBUM_GRID_PRESET.smCols}
                  lgCols={ALBUM_GRID_PRESET.lgCols}
                  xlCols={ALBUM_GRID_PRESET.xlCols}
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
                          className="aspect-[4/3] w-full object-cover transition-transform duration-[var(--fb-motion-duration-small)] ease-[var(--fb-motion-easing-standard)] group-hover:scale-[1.02]"
                        />
                      ) : (
                        <div className="aspect-[4/3] w-full bg-fb-surface-base" />
                      )}

                      <div className="space-y-2 px-3 py-3">
                        {photo.needs_manual_qc ? <span className="inline-flex rounded-md bg-fb-surface-base px-2 py-1 text-[10px] font-medium text-fb-text-secondary">Må vurderes</span> : null}
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
                    Last flere opptak
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
