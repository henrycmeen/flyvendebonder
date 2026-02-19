import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, RefreshCw, ChevronLeft, ChevronRight, Pencil, X } from "lucide-react";

import { apiGet, apiPatch, apiPost, ApiError } from "@/lib/api";
import { subscribeClientLogs } from "@/lib/client-logger";
import type { BaseMapStyle } from "@/lib/map-styles";
import { AlbumPage } from "@/components/album-page";
import { MapCanvas } from "@/components/map-canvas";
import { PhotoMapInset } from "@/components/photo-map-inset";
import { SideRail } from "@/components/side-rail";
import { TimelineBottom } from "@/components/timeline-bottom";
import { Button } from "@/components/ui/button";
import type {
  GardskartJob,
  PhotoAnalysis,
  PhotoAnalysisActionResponse,
  PhotoMetadataActionResponse,
  PhotoFeature,
  PhotosPageResponse,
  PhotosResponse,
  ProfileResponse,
  TimelineDate,
  TimelineResponse,
} from "@/types";

interface LogEntry {
  id: string;
  time: string;
  level: "info" | "warn" | "error";
  message: string;
  requestId?: string | null;
  details?: string;
}

interface BackendLogEntry {
  timestamp: string;
  level: string;
  logger: string;
  request_id?: string | null;
  requestId?: string | null;
  message: string;
  raw: string;
}

interface ManualViewTarget {
  lat: number;
  lng: number;
}

const LOG_LIMIT = 220;

type SeasonFilter = "all" | "spring" | "summer" | "autumn" | "winter";
type DayScope = "all" | "selected";
type AppView = "map" | "album";
type UiTheme = "standard" | "satellite";
const CONFIDENCE_FILTER_THRESHOLD = 0.72;
const MAP_PHOTO_PAGE_LIMIT = 180;
const MAP_PHOTO_TIMEOUT_MS = 45_000;
const MAP_PHOTO_MAX_PAGES = 80;
const MAX_NEAREST_PATH_PHOTOS = 900;
const PREF_MAP_STYLE_KEY = "fb.map.baseStyle";
const PREF_MAP_STYLE_MANUAL_KEY = "fb.map.baseStyle.manual";
const PREF_MAP_GRAYSCALE_KEY = "fb.map.grayscale";
const PREF_MAP_VINTAGE_KEY = "fb.map.vintage";

const isRequestAborted = (error: ApiError): boolean =>
  error.status === 0 && error.message === "Request avbrutt";

interface TimelineEntryIndexed extends TimelineDate {
  index: number;
  year: string;
  month: string;
  season: Exclude<SeasonFilter, "all">;
}

function monthToSeason(month: string): Exclude<SeasonFilter, "all"> {
  const number = Number(month);
  if (number >= 3 && number <= 5) return "spring";
  if (number >= 6 && number <= 8) return "summer";
  if (number >= 9 && number <= 11) return "autumn";
  return "winter";
}

function seasonLabel(season: SeasonFilter): string {
  if (season === "spring") return "Vår";
  if (season === "summer") return "Sommer";
  if (season === "autumn") return "Høst";
  if (season === "winter") return "Vinter";
  return "Hele året";
}

function splitCapturedDate(value: string): { year: string; month: string } | null {
  if (typeof value !== "string" || value.length < 7) return null;
  return {
    year: value.slice(0, 4),
    month: value.slice(5, 7),
  };
}

function buildPhotoStatusText(
  count: number,
  year: string,
  season: SeasonFilter,
  dayScope: DayScope,
  selectedDate: string | null,
): string {
  const yearText = year === "all" ? "alle år" : `år ${year}`;
  const seasonText = seasonLabel(season).toLowerCase();
  const dayText = dayScope === "all" ? "alle dager" : selectedDate ? `dag ${selectedDate}` : "valgt dag";
  return `${count} bilder vist (${yearText}, ${seasonText}, ${dayText})`;
}

function formatCapturedAt(value: string): string {
  try {
    return new Date(value).toLocaleString("nb-NO", {
      dateStyle: "full",
      timeStyle: "short",
      hour12: false,
    });
  } catch {
    return value;
  }
}

function formatCoordinate(value: number): string {
  return Number.isFinite(value) ? value.toFixed(6) : "ukjent";
}

function formatMeters(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "ukjent";
  return `${value.toFixed(1)} m`;
}

function formatPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "ukjent";
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function formatGsd(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "ukjent";
  return `${(value * 100).toFixed(2)} cm/px`;
}

function formatConfidence(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "ukjent";
  const normalized = Math.max(0, Math.min(1, value));
  return `${Math.round(normalized * 100)}%`;
}

function formatQCRating(source: string | null): string {
  if (source == null || source.trim() === "") return "ukjent";
  return source;
}

function toDraftNumber(value: number | null, decimals = 1): string {
  if (value == null || !Number.isFinite(value)) return "";
  return value.toFixed(decimals);
}

function parseDraftNumber(value: string): { valid: boolean; value: number | null } {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return { valid: true, value: null };
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return { valid: false, value: null };
  return { valid: true, value: parsed };
}

function numbersEqual(a: number | null, b: number | null): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) < 0.000001;
}

function parseManualViewTarget(tags: string[] | null | undefined): ManualViewTarget | null {
  if (!tags?.length) return null;
  const latTag = tags.find((tag) => tag.startsWith("meta:manual_view_lat="));
  const lngTag = tags.find((tag) => tag.startsWith("meta:manual_view_lng="));
  if (!latTag || !lngTag) return null;
  const lat = Number(latTag.slice("meta:manual_view_lat=".length));
  const lng = Number(lngTag.slice("meta:manual_view_lng=".length));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function sameManualViewTarget(a: ManualViewTarget | null, b: ManualViewTarget | null): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return Math.abs(a.lat - b.lat) < 0.000001 && Math.abs(a.lng - b.lng) < 0.000001;
}

function formatGeometryMethod(value: string | null): string {
  if (value === "estimated") return "estimert";
  if (value === "point") return "punkt";
  if (value === "manual") return "manuell";
  return "ikke satt";
}

function getAnalysisConfidenceTone(confidence: number | null): "good" | "medium" | "low" | "none" {
  if (confidence == null) return "none";
  if (confidence >= 0.75) return "good";
  if (confidence >= 0.6) return "medium";
  return "low";
}

function getAnalysisToneText(confidence: number | null): string {
  if (confidence == null) return "Mangler verdi";
  const tone = getAnalysisConfidenceTone(confidence);
  if (tone === "good") return "Høy";
  if (tone === "medium") return "Middels";
  return "Lav";
}

function toLogDetails(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeTagsInput(values: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  values.forEach((value) => {
    const tag = value.trim();
    if (!tag) return;
    const key = tag.toLocaleLowerCase("nb-NO");
    if (seen.has(key)) return;
    seen.add(key);
    result.push(tag.slice(0, 72));
  });
  return result;
}

function photoIdKey(id: string | number | null | undefined): string {
  return String(id ?? "");
}

function mergePhotoPages(existing: PhotoFeature[], incoming: PhotoFeature[]): PhotoFeature[] {
  if (existing.length === 0) return incoming;
  if (incoming.length === 0) return existing;

  const seen = new Set(existing.map((photo) => photoIdKey(photo.id)));
  const next = [...existing];
  incoming.forEach((photo) => {
    const key = photoIdKey(photo.id);
    if (seen.has(key)) return;
    seen.add(key);
    next.push(photo);
  });
  return next;
}

function compareByCapturedAtThenId(a: PhotoFeature, b: PhotoFeature): number {
  const aTime = Date.parse(a.captured_at);
  const bTime = Date.parse(b.captured_at);
  const safeATime = Number.isNaN(aTime) ? 0 : aTime;
  const safeBTime = Number.isNaN(bTime) ? 0 : bTime;
  const diff = safeATime - safeBTime;
  if (diff !== 0) return diff;
  return a.id.localeCompare(b.id);
}

function distanceScore(a: PhotoFeature, b: PhotoFeature): number {
  const latMidRad = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const lngFactor = Math.cos(latMidRad);
  const dx = (a.lng - b.lng) * lngFactor;
  const dy = a.lat - b.lat;
  return dx * dx + dy * dy;
}

function buildNearestPath(photos: PhotoFeature[], anchorId: string): PhotoFeature[] {
  if (photos.length <= 1) return photos;
  if (photos.length > MAX_NEAREST_PATH_PHOTOS) {
    // O(n²)-banen blir for tung på store datasett; bruk deterministisk tidsrekkefølge.
    return [...photos].sort(compareByCapturedAtThenId);
  }
  const byId = new Map(photos.map((photo) => [photo.id, photo]));
  const anchor = byId.get(anchorId);
  if (!anchor) {
    return [...photos].sort(compareByCapturedAtThenId);
  }

  const remaining = new Map(byId);
  remaining.delete(anchorId);

  const ordered: PhotoFeature[] = [anchor];
  let current = anchor;

  while (remaining.size > 0) {
    let nextId: string | null = null;
    let nextPhoto: PhotoFeature | null = null;
    let best = Number.POSITIVE_INFINITY;

    remaining.forEach((candidate) => {
      const score = distanceScore(current, candidate);
      if (score < best) {
        best = score;
        nextPhoto = candidate;
        nextId = candidate.id;
        return;
      }
      if (score === best && nextPhoto && compareByCapturedAtThenId(candidate, nextPhoto) < 0) {
        nextPhoto = candidate;
        nextId = candidate.id;
      }
    });

    if (!nextPhoto || !nextId) break;
    ordered.push(nextPhoto);
    remaining.delete(nextId);
    current = nextPhoto;
  }

  return ordered;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

export default function App() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const initialDate = params.get("date");
  const initialPhoto = params.get("photo");
  const initialView = params.get("view") === "album" ? "album" : "map";
  const hasExplicitDeepLink = initialDate !== null || initialPhoto !== null;

  const [activeView, setActiveView] = useState<AppView>(initialView);
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [timeline, setTimeline] = useState<TimelineDate[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedYear, setSelectedYear] = useState<string>("all");
  const [selectedSeason, setSelectedSeason] = useState<SeasonFilter>("all");
  const [dayScope, setDayScope] = useState<DayScope>("all");
  const [photoPool, setPhotoPool] = useState<PhotoFeature[]>([]);
  const [albumPhotos, setAlbumPhotos] = useState<PhotoFeature[]>([]);
  const [albumCursor, setAlbumCursor] = useState<string | null>(null);
  const [albumHasMore, setAlbumHasMore] = useState(false);
  const [albumLoadingInitial, setAlbumLoadingInitial] = useState(false);
  const [albumLoadingMore, setAlbumLoadingMore] = useState(false);
  const [albumLoadedDate, setAlbumLoadedDate] = useState<string | null>(null);
  const [mapNavigationAnchorId, setMapNavigationAnchorId] = useState<string | null>(null);
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);
  const [hoverPreviewPhotoId, setHoverPreviewPhotoId] = useState<string | null>(null);
  const [isPhotoViewerOpen, setIsPhotoViewerOpen] = useState(false);
  const [baseMapStyle, setBaseMapStyle] = useState<BaseMapStyle>("osm");
  const [mapGrayscale, setMapGrayscale] = useState(false);
  const [mapVintage, setMapVintage] = useState(false);
  const [job, setJob] = useState<GardskartJob | null>(null);
  const [showPropertyLayer, setShowPropertyLayer] = useState(true);
  const [showOnlyManualQc, setShowOnlyManualQc] = useState(false);
  const [showOnlyLowConfidence, setShowOnlyLowConfidence] = useState(false);
  const [propertyStatus, setPropertyStatus] = useState("Eiendomslag venter på data ...");
  const [statusText, setStatusText] = useState("Laster data ...");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [backendLogs, setBackendLogs] = useState<BackendLogEntry[]>([]);
  const [isBackendLogsLoading, setIsBackendLogsLoading] = useState(false);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [analysisBusyPhotoId, setAnalysisBusyPhotoId] = useState<string | null>(null);
  const [metadataBusyPhotoId, setMetadataBusyPhotoId] = useState<string | null>(null);
  const [metadataEditMode, setMetadataEditMode] = useState(false);
  const [showTechnicalMetadata, setShowTechnicalMetadata] = useState(false);
  const [metadataTagDraft, setMetadataTagDraft] = useState("");
  const [metadataTagsDraft, setMetadataTagsDraft] = useState<string[]>([]);
  const [metadataCaptionDraft, setMetadataCaptionDraft] = useState("");
  const [metadataNeedsManualQcDraft, setMetadataNeedsManualQcDraft] = useState(false);
  const [metadataAltitudeDraft, setMetadataAltitudeDraft] = useState("");
  const [metadataHeadingDraft, setMetadataHeadingDraft] = useState("");
  const [metadataPitchDraft, setMetadataPitchDraft] = useState("");
  const [metadataManualViewTargetDraft, setMetadataManualViewTargetDraft] = useState<ManualViewTarget | null>(null);
  const [photosLoadFailed, setPhotosLoadFailed] = useState(false);
  const [photoLoadRetryToken, setPhotoLoadRetryToken] = useState(0);
  const [albumLoadFailed, setAlbumLoadFailed] = useState(false);
  const [albumScrollSpin, setAlbumScrollSpin] = useState(false);
  const [mapFocusToken, setMapFocusToken] = useState(0);
  const [mapResetToken, setMapResetToken] = useState(0);
  const [syncSelectionToUrl, setSyncSelectionToUrl] = useState(() => Boolean(initialDate || initialPhoto));
  const uiTheme: UiTheme = baseMapStyle === "satellite" ? "satellite" : "standard";

  const initialPhotoRef = useRef<string | null>(initialPhoto);
  const tileRetryJobRef = useRef<string | null>(null);
  const albumScrollSpinTimeoutRef = useRef<number | null>(null);
  const bootstrapAbortRef = useRef<AbortController | null>(null);
  const profileAbortRef = useRef<AbortController | null>(null);
  const timelineAbortRef = useRef<AbortController | null>(null);
  const photosAbortRef = useRef<AbortController | null>(null);
  const backendLogAbortRef = useRef<AbortController | null>(null);
  const gardskartJobAbortRef = useRef<AbortController | null>(null);
  const albumAbortRef = useRef<AbortController | null>(null);
  const photoLoadSeqRef = useRef(0);
  const albumLoadSeqRef = useRef(0);
  const profileLoadSeqRef = useRef(0);
  const timelineLoadSeqRef = useRef(0);
  const backendLogLoadSeqRef = useRef(0);
  const gardskartJobLoadSeqRef = useRef(0);
  const bootstrapLoadSeqRef = useRef(0);

  const selectedDate = timeline[selectedIndex]?.date ?? null;
  const isLoading = pendingRequests > 0;
  const photos = useMemo(() => {
    if (dayScope === "selected") {
      if (!selectedDate) return [];
      return photoPool.filter((photo) => photo.captured_date === selectedDate);
    }

    return photoPool;
  }, [dayScope, photoPool, selectedDate]);
  const selectedPhoto = useMemo(() => {
    if (!selectedPhotoId) return null;
    return (
      photos.find((photo) => photoIdKey(photo.id) === photoIdKey(selectedPhotoId)) ??
      albumPhotos.find((photo) => photoIdKey(photo.id) === photoIdKey(selectedPhotoId)) ??
      null
    );
  }, [albumPhotos, photos, selectedPhotoId]);
  const selectedPhotoManualViewTarget = useMemo(
    () => parseManualViewTarget(selectedPhoto?.tags),
    [selectedPhoto?.tags],
  );
  const hoverPreviewPhoto = useMemo(() => {
    if (!hoverPreviewPhotoId) return null;
    return photos.find((photo) => photoIdKey(photo.id) === photoIdKey(hoverPreviewPhotoId)) ?? null;
  }, [hoverPreviewPhotoId, photos]);
  const resolvedMapAnchorId = useMemo(() => {
    if (!selectedPhotoId) return null;
    if (mapNavigationAnchorId && photos.some((photo) => photoIdKey(photo.id) === photoIdKey(mapNavigationAnchorId))) {
      return mapNavigationAnchorId;
    }
    return photoIdKey(selectedPhotoId);
  }, [mapNavigationAnchorId, photos, selectedPhotoId]);
  const navigationPhotos = useMemo(() => {
    if (activeView === "album") {
      return [...albumPhotos].sort(compareByCapturedAtThenId);
    }

    if (photos.length === 0) return [];
    if (!resolvedMapAnchorId) return [...photos].sort(compareByCapturedAtThenId);
    return buildNearestPath(photos, resolvedMapAnchorId);
  }, [activeView, albumPhotos, photos, resolvedMapAnchorId]);
  const selectedNavigationIndex = useMemo(() => {
    if (!selectedPhotoId) return -1;
    return navigationPhotos.findIndex((photo) => photoIdKey(photo.id) === photoIdKey(selectedPhotoId));
  }, [navigationPhotos, selectedPhotoId]);
  const hasPrevPhoto = selectedNavigationIndex > 0;
  const hasNextPhoto = selectedNavigationIndex >= 0 && selectedNavigationIndex < navigationPhotos.length - 1;
  const activeInsetManualTarget = useMemo(
    () => (metadataEditMode ? metadataManualViewTargetDraft : selectedPhotoManualViewTarget),
    [metadataEditMode, metadataManualViewTargetDraft, selectedPhotoManualViewTarget],
  );
  const stripPhotos = useMemo(() => {
    if (selectedNavigationIndex < 0) return [];
    const start = Math.max(0, selectedNavigationIndex - 7);
    const end = Math.min(navigationPhotos.length, selectedNavigationIndex + 8);
    return navigationPhotos.slice(start, end);
  }, [navigationPhotos, selectedNavigationIndex]);
  const hasMetadataChanges = useMemo(() => {
    if (!selectedPhoto) return false;
    const currentTags = normalizeTagsInput(selectedPhoto.tags ?? []);
    const draftTags = normalizeTagsInput(metadataTagsDraft);
    const currentCaption = (selectedPhoto.caption ?? "").trim();
    const draftCaption = metadataCaptionDraft.trim();
    const draftAltitude = parseDraftNumber(metadataAltitudeDraft);
    const draftHeading = parseDraftNumber(metadataHeadingDraft);
    const draftPitch = parseDraftNumber(metadataPitchDraft);
    return (
      JSON.stringify(currentTags) !== JSON.stringify(draftTags) ||
      currentCaption !== draftCaption ||
      Boolean(selectedPhoto.needs_manual_qc) !== metadataNeedsManualQcDraft ||
      !draftAltitude.valid ||
      !draftHeading.valid ||
      !draftPitch.valid ||
      !numbersEqual(selectedPhoto.altitude_m, draftAltitude.value) ||
      !numbersEqual(selectedPhoto.heading_deg, draftHeading.value) ||
      !numbersEqual(selectedPhoto.pitch_deg, draftPitch.value) ||
      !sameManualViewTarget(selectedPhotoManualViewTarget, metadataManualViewTargetDraft)
    );
  }, [
    metadataAltitudeDraft,
    metadataCaptionDraft,
    metadataHeadingDraft,
    metadataManualViewTargetDraft,
    metadataNeedsManualQcDraft,
    metadataPitchDraft,
    metadataTagsDraft,
    selectedPhoto,
    selectedPhotoManualViewTarget,
  ]);

  const timelineIndexed = useMemo<TimelineEntryIndexed[]>(
    () =>
      timeline.map((entry, index) => ({
        ...entry,
        index,
        year: entry.date.slice(0, 4),
        month: entry.date.slice(5, 7),
        season: monthToSeason(entry.date.slice(5, 7)),
      })),
    [timeline],
  );

  const availableYears = useMemo(
    () => Array.from(new Set(timelineIndexed.map((entry) => entry.year))).sort((a, b) => Number(b) - Number(a)),
    [timelineIndexed],
  );

  const seasonCounts = useMemo(() => {
    const source = selectedYear === "all" ? timelineIndexed : timelineIndexed.filter((entry) => entry.year === selectedYear);
    return {
      spring: source.filter((entry) => entry.season === "spring").length,
      summer: source.filter((entry) => entry.season === "summer").length,
      autumn: source.filter((entry) => entry.season === "autumn").length,
      winter: source.filter((entry) => entry.season === "winter").length,
    };
  }, [selectedYear, timelineIndexed]);

  const filteredTimeline = useMemo(
    () =>
      timelineIndexed.filter((entry) => {
        if (selectedYear !== "all" && entry.year !== selectedYear) return false;
        if (selectedSeason !== "all" && entry.season !== selectedSeason) return false;
        return true;
      }),
    [selectedSeason, selectedYear, timelineIndexed],
  );
  const latestFilteredDate = filteredTimeline[filteredTimeline.length - 1]?.date ?? null;
  const latestTimelineDate = timeline[timeline.length - 1]?.date ?? null;
  const filteredTimelineHasData = filteredTimeline.length > 0;

  const trackRequest = useCallback(async <T,>(task: () => Promise<T>): Promise<T> => {
    setPendingRequests((count) => count + 1);
    try {
      return await task();
    } finally {
      setPendingRequests((count) => Math.max(0, count - 1));
    }
  }, []);

  const addLog = useCallback((level: LogEntry["level"], message: string, requestId?: string | null, details?: unknown) => {
    const entry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      time: new Date().toLocaleTimeString("nb-NO", { hour12: false }),
      level,
      message,
      requestId,
      details: details ? toLogDetails(details) : undefined,
    };

    setLogs((prev) => {
      const next = [...prev, entry];
      if (next.length > LOG_LIMIT) {
        return next.slice(next.length - LOG_LIMIT);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeClientLogs((entry) => {
      setLogs((previous) => {
        const next = [
          ...previous,
          {
            id: entry.id,
            time: entry.time,
            level: entry.level,
            message: entry.message,
            requestId: entry.requestId,
            details: entry.details ? toLogDetails(entry.details) : undefined,
          },
        ];
        if (next.length > LOG_LIMIT) {
          return next.slice(next.length - LOG_LIMIT);
        }
        return next;
      });
    });
    return unsubscribe;
  }, []);

  const loadProfile = useCallback(async (options?: { signal?: AbortSignal }): Promise<ProfileResponse> => {
    const seq = ++profileLoadSeqRef.current;
    const requestController = options?.signal
      ? null
      : (() => {
          profileAbortRef.current?.abort();
          const next = new AbortController();
          profileAbortRef.current = next;
          return next;
        })();

    return trackRequest(async () => {
      const { data, requestId } = await apiGet<ProfileResponse>("/api/v1/profile/current", {
        signal: requestController?.signal ?? options?.signal,
      });

      if (seq !== profileLoadSeqRef.current) return data;

      setProfile(data);
      addLog("info", "Profil lastet", requestId, { userId: data.user.id });
      return data;
    });
  }, [addLog, trackRequest]);

  const loadTimeline = useCallback(async (options?: { signal?: AbortSignal }): Promise<TimelineResponse> => {
    const seq = ++timelineLoadSeqRef.current;
    const requestController = options?.signal
      ? null
      : (() => {
          timelineAbortRef.current?.abort();
          const next = new AbortController();
          timelineAbortRef.current = next;
          return next;
        })();

    return trackRequest(async () => {
      const { data, requestId } = await apiGet<TimelineResponse>("/api/v1/timeline/dates", {
        signal: requestController?.signal ?? options?.signal,
      });

      if (seq !== timelineLoadSeqRef.current) return data;

      setTimeline(data.dates);
      addLog("info", "Tidslinje lastet", requestId, { days: data.dates.length });
      return data;
    });
  }, [addLog, trackRequest]);

  const loadBackendLogs = useCallback(async (options?: { signal?: AbortSignal }) => {
    const seq = ++backendLogLoadSeqRef.current;
    const requestController = options?.signal
      ? null
      : (() => {
          backendLogAbortRef.current?.abort();
          const next = new AbortController();
          backendLogAbortRef.current = next;
          return next;
        })();

    setIsBackendLogsLoading(true);
    try {
      const { data, requestId } = await apiGet<{
        count: number;
        source: string;
        lines: BackendLogEntry[];
      }>(`/api/v1/logs`, {
        query: { limit: 120 },
        signal: requestController?.signal ?? options?.signal,
      });

      if (seq !== backendLogLoadSeqRef.current) return;

      setBackendLogs(
        data.lines.map((line) => ({
          ...line,
          requestId: line.request_id ?? line.requestId ?? null,
        })),
      );
      addLog("info", "Backendlogg lastet", requestId, {
        count: data.count,
        source: data.source,
      });
    } catch (error) {
      const apiError = error as ApiError;
      if (seq !== backendLogLoadSeqRef.current) return;
      if (isRequestAborted(apiError)) return;
      addLog("error", "Kunne ikke hente backendlogg", apiError.requestId, apiError.detail);
    } finally {
      setIsBackendLogsLoading(false);
    }
  }, [addLog]);

  const updatePhotoAnalysisState = useCallback((photoId: string, analysis: PhotoAnalysis | null) => {
    setPhotoPool((previous) =>
      previous.map((photo) =>
        photo.id === photoId ? { ...photo, analysis } : photo,
      ),
    );
    setAlbumPhotos((previous) =>
      previous.map((photo) =>
        photo.id === photoId ? { ...photo, analysis } : photo,
      ),
    );
  }, []);

  const updatePhotoMetadataState = useCallback(
    (
      photoId: string,
      tags: string[],
      caption: string | null,
      needsManualQc: boolean,
      altitudeM: number | null,
      headingDeg: number | null,
      pitchDeg: number | null,
    ) => {
      setPhotoPool((previous) =>
        previous.map((photo) =>
          photo.id === photoId
            ? {
                ...photo,
                tags,
                caption,
                needs_manual_qc: needsManualQc,
                altitude_m: altitudeM,
                heading_deg: headingDeg,
                pitch_deg: pitchDeg,
              }
            : photo,
        ),
      );
      setAlbumPhotos((previous) =>
        previous.map((photo) =>
          photo.id === photoId
            ? {
                ...photo,
                tags,
                caption,
                needs_manual_qc: needsManualQc,
                altitude_m: altitudeM,
                heading_deg: headingDeg,
                pitch_deg: pitchDeg,
              }
            : photo,
        ),
      );
    },
    [],
  );

  const loadGardskartJob = useCallback(
    async (forceRefresh: boolean, options?: { signal?: AbortSignal }) => {
      if (!profile?.property || !showPropertyLayer) {
        return;
      }

      const seq = ++gardskartJobLoadSeqRef.current;
      const requestController = options?.signal
        ? null
        : (() => {
            gardskartJobAbortRef.current?.abort();
            const next = new AbortController();
            gardskartJobAbortRef.current = next;
            return next;
          })();

      try {
        const { data, requestId } = await trackRequest(() =>
          apiGet<GardskartJob>(`/api/v1/properties/current/gardskart-job`, {
            query: { force_refresh: forceRefresh ? true : undefined },
            signal: requestController?.signal ?? options?.signal,
          }),
        );

      if (seq !== gardskartJobLoadSeqRef.current) return;

      setJob(data);
        const statusDescLower = (data.status_desc ?? "").toLowerCase();
        const statusIsOk =
          data.status_code === null ||
          data.status_code === 0 ||
          data.status_code === 1 ||
          statusDescLower.includes("response ok");

        if (data.source === "stale-cache") {
          setPropertyStatus("Eiendomslag bruker cache pga feil mot NIBIO. Se teknisk logg.");
        } else if (!statusIsOk) {
          if (data.status_code === 100) {
            setPropertyStatus("NIBIO kunne ikke hente eiendomsgrenser for denne eiendommen nå (kode 100).");
          } else {
            setPropertyStatus("Eiendomslag aktivt, men NIBIO meldte avvik. Se teknisk logg.");
          }
          addLog("warn", "NIBIO returnerte avvik for eiendomslag", requestId, {
            statusCode: data.status_code,
            statusDesc: data.status_desc,
            source: data.source,
          });
        } else {
          setPropertyStatus("Eiendomslag aktivt.");
        }

        addLog("info", forceRefresh ? "jobId tvangsfornyet" : "jobId lastet", requestId, {
          source: data.source,
          statusCode: data.status_code,
          jobId: data.job_id,
        });
      } catch (error) {
        const apiError = error as ApiError;
        if (seq !== gardskartJobLoadSeqRef.current) return;
        if (isRequestAborted(apiError)) return;
        setPropertyStatus("Kunne ikke hente eiendomslag fra backend.");
        addLog("error", "jobId-henting feilet", apiError.requestId, apiError.detail);
      }
    },
    [addLog, profile?.property, showPropertyLayer, trackRequest],
  );

  const handlePhotoAnalysisAction = useCallback(
    async (photoId: string, action: "approve" | "recompute") => {
      if (analysisBusyPhotoId === photoId) return;

      setAnalysisBusyPhotoId(photoId);
      try {
        const endpoint =
          action === "approve"
            ? `/api/v1/photos/${photoId}/approve-analysis`
            : `/api/v1/photos/${photoId}/recompute-analysis`;

        const { data, requestId } = await trackRequest(() =>
          apiPost<PhotoAnalysisActionResponse>(endpoint),
        );

        updatePhotoAnalysisState(photoId, data.analysis);
        addLog(
          "info",
          action === "approve" ? "Analysering godkjent" : "Analysering oppdatert",
          requestId,
          { photoId, status: data.status },
        );
        setStatusText("Bildeanalyse oppdatert");
      } catch (error) {
        const apiError = error as ApiError;
        addLog(
          "error",
          action === "approve" ? "Godkjenning feilet" : "Oppdatering av analyse feilet",
          apiError.requestId,
          apiError.detail,
        );
        setStatusText(action === "approve" ? "Kunne ikke godkjenne analyse." : "Kunne ikke oppdatere analyse.");
      } finally {
        setAnalysisBusyPhotoId(null);
      }
    },
    [addLog, analysisBusyPhotoId, trackRequest, updatePhotoAnalysisState],
  );

  const handleSavePhotoMetadata = useCallback(async () => {
    if (!selectedPhoto) return;
    if (metadataBusyPhotoId === selectedPhoto.id) return;

    const nextTags = normalizeTagsInput(metadataTagsDraft);
    const nextCaption = metadataCaptionDraft.trim();
    const nextNeedsManualQc = metadataNeedsManualQcDraft;
    const manualTargetChanged = !sameManualViewTarget(selectedPhotoManualViewTarget, metadataManualViewTargetDraft);
    const altitudeInput = parseDraftNumber(metadataAltitudeDraft);
    const headingInput = parseDraftNumber(metadataHeadingDraft);
    const pitchInput = parseDraftNumber(metadataPitchDraft);
    if (!altitudeInput.valid || !headingInput.valid || !pitchInput.valid) {
      setStatusText("Ugyldig tallformat i metadata. Bruk for eksempel 123.4");
      addLog("warn", "Ugyldig tallformat i metadata-redigering");
      return;
    }

    setMetadataBusyPhotoId(selectedPhoto.id);
    try {
      const { data, requestId } = await trackRequest(() =>
        apiPatch<PhotoMetadataActionResponse>(`/api/v1/photos/${selectedPhoto.id}/metadata`, {
          tags: nextTags,
          caption: nextCaption,
          needs_manual_qc: nextNeedsManualQc,
          altitude_m: altitudeInput.value,
          heading_deg: headingInput.value,
          pitch_deg: pitchInput.value,
          ...(manualTargetChanged
            ? {
                manual_view_lat: metadataManualViewTargetDraft?.lat ?? null,
                manual_view_lng: metadataManualViewTargetDraft?.lng ?? null,
              }
            : {}),
        }),
      );

      updatePhotoMetadataState(
        data.photo_id,
        data.tags,
        data.caption,
        data.needs_manual_qc,
        data.altitude_m,
        data.heading_deg,
        data.pitch_deg,
      );
      setMetadataTagsDraft(data.tags);
      setMetadataCaptionDraft(data.caption ?? "");
      setMetadataNeedsManualQcDraft(data.needs_manual_qc);
      setMetadataAltitudeDraft(toDraftNumber(data.altitude_m));
      setMetadataHeadingDraft(toDraftNumber(data.heading_deg));
      setMetadataPitchDraft(toDraftNumber(data.pitch_deg));
      setMetadataManualViewTargetDraft(
        data.manual_view_lat != null && data.manual_view_lng != null
          ? { lat: data.manual_view_lat, lng: data.manual_view_lng }
          : null,
      );
      setMetadataTagDraft("");
      addLog("info", "Metadata lagret", requestId, {
        photoId: data.photo_id,
        tags: data.tags.length,
        needs_manual_qc: data.needs_manual_qc,
      });
      setStatusText("Metadata oppdatert.");
      setMetadataEditMode(false);
    } catch (error) {
      const apiError = error as ApiError;
      addLog("error", "Kunne ikke lagre metadata", apiError.requestId, apiError.detail);
      setStatusText(`Kunne ikke lagre metadata: ${apiError.message}`);
    } finally {
      setMetadataBusyPhotoId(null);
    }
  }, [
    addLog,
    metadataBusyPhotoId,
    metadataAltitudeDraft,
    metadataCaptionDraft,
    metadataHeadingDraft,
    metadataManualViewTargetDraft,
    metadataTagsDraft,
    selectedPhoto,
    selectedPhotoManualViewTarget,
    trackRequest,
    updatePhotoMetadataState,
    metadataNeedsManualQcDraft,
    metadataPitchDraft,
  ]);

  const handleCancelMetadataEdit = useCallback(() => {
    if (!selectedPhoto) return;
    setMetadataTagDraft("");
    setMetadataTagsDraft(selectedPhoto.tags ?? []);
    setMetadataCaptionDraft(selectedPhoto.caption ?? "");
    setMetadataNeedsManualQcDraft(selectedPhoto.needs_manual_qc);
    setMetadataAltitudeDraft(toDraftNumber(selectedPhoto.altitude_m));
    setMetadataHeadingDraft(toDraftNumber(selectedPhoto.heading_deg));
    setMetadataPitchDraft(toDraftNumber(selectedPhoto.pitch_deg));
    setMetadataManualViewTargetDraft(parseManualViewTarget(selectedPhoto.tags));
    setMetadataEditMode(false);
  }, [selectedPhoto]);

  const selectPhoto = useCallback(
    (photoId: string, options?: { anchorMap?: boolean; focusMap?: boolean }) => {
      setSyncSelectionToUrl(true);
      setSelectedPhotoId(photoId);
      if (options?.focusMap !== false) {
        setMapFocusToken((value) => value + 1);
      }
      if (activeView === "map" && options?.anchorMap !== false) {
        setMapNavigationAnchorId(photoId);
      }
    },
    [activeView],
  );

  const handleSelectPhoto = useCallback(
    (photoId: string) => {
      setHoverPreviewPhotoId(null);
      selectPhoto(photoId);
    },
    [selectPhoto],
  );

  const handleHoverPhoto = useCallback(
    (photoId: string | null) => {
      setHoverPreviewPhotoId(photoId);
    },
    [],
  );

  const handleOpenPhotoViewer = useCallback(
    (photoId: string) => {
      setHoverPreviewPhotoId(null);
      selectPhoto(photoId, { focusMap: activeView === "map" });
      setIsPhotoViewerOpen(true);
    },
    [activeView, selectPhoto],
  );

  const handleClosePhotoViewer = useCallback(() => {
    setIsPhotoViewerOpen(false);
  }, []);

  useEffect(() => {
    if (activeView !== "map" && hoverPreviewPhotoId) {
      setHoverPreviewPhotoId(null);
      return;
    }
    if (hoverPreviewPhotoId && !photos.some((photo) => photoIdKey(photo.id) === photoIdKey(hoverPreviewPhotoId))) {
      setHoverPreviewPhotoId(null);
    }
  }, [activeView, hoverPreviewPhotoId, photos]);

  useEffect(() => {
    if (!selectedPhoto) {
      setMetadataTagDraft("");
      setMetadataTagsDraft([]);
      setMetadataCaptionDraft("");
      setMetadataNeedsManualQcDraft(false);
      setMetadataAltitudeDraft("");
      setMetadataHeadingDraft("");
      setMetadataPitchDraft("");
      setMetadataManualViewTargetDraft(null);
      setMetadataEditMode(false);
      setShowTechnicalMetadata(false);
      return;
    }
    setMetadataTagDraft("");
    setMetadataTagsDraft(selectedPhoto.tags ?? []);
    setMetadataCaptionDraft(selectedPhoto.caption ?? "");
    setMetadataNeedsManualQcDraft(selectedPhoto.needs_manual_qc);
    setMetadataAltitudeDraft(toDraftNumber(selectedPhoto.altitude_m));
    setMetadataHeadingDraft(toDraftNumber(selectedPhoto.heading_deg));
    setMetadataPitchDraft(toDraftNumber(selectedPhoto.pitch_deg));
    setMetadataManualViewTargetDraft(parseManualViewTarget(selectedPhoto.tags));
    setMetadataEditMode(false);
    setShowTechnicalMetadata(false);
  }, [selectedPhoto]);

  useEffect(() => {
    const storedStyle = window.localStorage.getItem(PREF_MAP_STYLE_KEY);
    const hasManualStyle = window.localStorage.getItem(PREF_MAP_STYLE_MANUAL_KEY) === "1";
    if (
      hasManualStyle &&
      (storedStyle === "osm" ||
        storedStyle === "topo" ||
        storedStyle === "light" ||
        storedStyle === "voyager" ||
        storedStyle === "satellite")
    ) {
      setBaseMapStyle(storedStyle);
    } else {
      setBaseMapStyle("osm");
    }

    const storedGrayscale = window.localStorage.getItem(PREF_MAP_GRAYSCALE_KEY);
    if (storedGrayscale === "1") {
      setMapGrayscale(true);
    }

    const storedVintage = window.localStorage.getItem(PREF_MAP_VINTAGE_KEY);
    if (storedVintage === "1") {
      setMapVintage(true);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(PREF_MAP_STYLE_KEY, baseMapStyle);
  }, [baseMapStyle]);

  useEffect(() => {
    window.localStorage.setItem(PREF_MAP_GRAYSCALE_KEY, mapGrayscale ? "1" : "0");
  }, [mapGrayscale]);

  useEffect(() => {
    window.localStorage.setItem(PREF_MAP_VINTAGE_KEY, mapVintage ? "1" : "0");
  }, [mapVintage]);

  useEffect(() => {
    const bootstrap = async (options?: { signal?: AbortSignal }) => {
      const seq = ++bootstrapLoadSeqRef.current;
      const requestController = options?.signal
        ? null
        : (() => {
            bootstrapAbortRef.current?.abort();
            const next = new AbortController();
            bootstrapAbortRef.current = next;
            return next;
          })();
      const signal = requestController?.signal ?? options?.signal;
      const maxAttempts = 5;
      let lastError: ApiError | null = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        setStatusText("Laster profil og tidslinje ...");
        try {
          const [profileData, timelineData] = await Promise.all([
            loadProfile({ signal }),
            loadTimeline({ signal }),
          ]);

          if (seq !== bootstrapLoadSeqRef.current || signal?.aborted) return;

          if (timelineData.dates.length === 0) {
            setSelectedYear("all");
            setSelectedSeason("all");
            setStatusText("Ingen bilder i databasen enda.");
            return;
          }

          const initialIndex = initialDate
            ? timelineData.dates.findIndex((entry) => entry.date === initialDate)
            : timelineData.dates.length - 1;

          const resolvedIndex = initialIndex >= 0 ? initialIndex : timelineData.dates.length - 1;
          const resolvedDate = timelineData.dates[resolvedIndex]?.date ?? timelineData.dates[timelineData.dates.length - 1].date;

          setSelectedIndex(resolvedIndex);
          setSelectedYear(resolvedDate.slice(0, 4));
          setSelectedSeason("all");
          setStatusText(`Klar for ${profileData.user.full_name}`);
          return;
        } catch (error) {
          const apiError = error as ApiError;
          if (seq !== bootstrapLoadSeqRef.current || signal?.aborted) return;
          if (isRequestAborted(apiError)) return;
          lastError = apiError;
          if (attempt < maxAttempts) {
            setStatusText(`Venter på backend ... (${attempt}/${maxAttempts})`);
            addLog("warn", "Oppstartsforsøk feilet, prøver igjen", apiError.requestId, {
              attempt,
              maxAttempts,
              message: apiError.message,
            });
            await new Promise((resolve) => window.setTimeout(resolve, 500 + attempt * 400));
            continue;
          }
        }
      }

      if (lastError && seq === bootstrapLoadSeqRef.current && !signal?.aborted) {
        setStatusText(`Oppstart feilet: ${lastError.message}`);
        addLog("error", "Oppstart feilet", lastError.requestId, lastError.detail);
      }
    };

    const abortController = new AbortController();
    void bootstrap({ signal: abortController.signal });

    return () => {
      abortController.abort();
    };
  }, [addLog, initialDate, loadProfile, loadTimeline]);

  useEffect(() => {
    if (selectedYear !== "all" && !availableYears.includes(selectedYear)) {
      setSelectedYear(availableYears[0] ?? "all");
      setSelectedSeason("all");
    }
  }, [availableYears, selectedYear]);

  useEffect(() => {
    if (selectedSeason === "all") return;
    const source = selectedYear === "all" ? timelineIndexed : timelineIndexed.filter((entry) => entry.year === selectedYear);
    if (!source.some((entry) => entry.season === selectedSeason)) {
      setSelectedSeason("all");
    }
  }, [selectedSeason, selectedYear, timelineIndexed]);

  useEffect(() => {
    if (activeView !== "map") return;
    if (!selectedPhotoId) {
      setMapNavigationAnchorId(null);
      return;
    }
    if (!mapNavigationAnchorId || !photos.some((photo) => photoIdKey(photo.id) === photoIdKey(mapNavigationAnchorId))) {
      setMapNavigationAnchorId(photoIdKey(selectedPhotoId));
    }
  }, [activeView, mapNavigationAnchorId, photos, selectedPhotoId]);

  const stepSelectedPhoto = useCallback(
    (direction: -1 | 1) => {
      if (selectedNavigationIndex < 0) return;
      const nextIndex = selectedNavigationIndex + direction;
      if (nextIndex < 0 || nextIndex >= navigationPhotos.length) return;
      const nextPhoto = navigationPhotos[nextIndex];
      if (!nextPhoto) return;
      selectPhoto(nextPhoto.id, { anchorMap: false });
    },
    [navigationPhotos, selectPhoto, selectedNavigationIndex],
  );

  useEffect(() => {
    if (isPhotoViewerOpen && !selectedPhotoId) {
      setIsPhotoViewerOpen(false);
    }
  }, [isPhotoViewerOpen, selectedPhotoId]);

  useEffect(() => {
    if (!selectedPhotoId) return;
    if (!(isPhotoViewerOpen || activeView === "map")) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;

      if (event.key === "Escape" && isPhotoViewerOpen) {
        event.preventDefault();
        setIsPhotoViewerOpen(false);
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        stepSelectedPhoto(1);
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        stepSelectedPhoto(-1);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [activeView, isPhotoViewerOpen, selectedPhotoId, stepSelectedPhoto]);

  useEffect(() => {
    if (filteredTimeline.length === 0) return;
    if (!filteredTimeline.some((entry) => entry.index === selectedIndex)) {
      setSelectedIndex(filteredTimeline[filteredTimeline.length - 1].index);
    }
  }, [filteredTimeline, selectedIndex]);

  useEffect(() => {
    const seq = ++photoLoadSeqRef.current;
    photosAbortRef.current?.abort();
    const abortController = new AbortController();
    photosAbortRef.current = abortController;

    const loadPhotos = async () => {
      if (!latestFilteredDate) {
        setPhotoPool([]);
        setPhotosLoadFailed(false);
        setSelectedPhotoId(null);
        setStatusText("Ingen bilder for valgt filter.");
        return;
      }

      const matchesClientFilters = (photo: PhotoFeature): boolean => {
        const dateParts = splitCapturedDate(photo.captured_date);
        if (!dateParts) return false;
        if (selectedYear !== "all" && dateParts.year !== selectedYear) return false;
        if (selectedSeason !== "all" && monthToSeason(dateParts.month) !== selectedSeason) return false;
        if (showOnlyManualQc && !photo.needs_manual_qc) return false;
        if (showOnlyLowConfidence && (photo.confidence_score == null || photo.confidence_score > CONFIDENCE_FILTER_THRESHOLD)) {
          return false;
        }
        return true;
      };

      const loadFallbackPhotos = async (reason: string): Promise<boolean> => {
        const { data, requestId } = await trackRequest(() =>
          apiGet<PhotosResponse>("/api/v1/photos", {
            query: {
              date: latestFilteredDate,
              mode: "cumulative",
              include_analysis: false,
            },
            signal: abortController.signal,
            timeoutMs: MAP_PHOTO_TIMEOUT_MS,
            cache: false,
            dedupe: false,
          }),
        );
        if (seq !== photoLoadSeqRef.current || abortController.signal.aborted) return true;
        const filteredPhotos = data.photos.filter(matchesClientFilters);
        setPhotoPool(filteredPhotos);
        setPhotosLoadFailed(false);
        addLog("warn", "Bruker fallback for kartbilder", requestId, {
          reason,
          apiDate: latestFilteredDate,
          count: filteredPhotos.length,
          year: selectedYear,
          season: selectedSeason,
        });
        return true;
      };

      try {
        let mergedPhotos: PhotoFeature[] = [];
        let cursor: string | null = null;
        let pagesLoaded = 0;
        let hasMore = true;
        let lastRequestId: string | null = null;

        while (hasMore && pagesLoaded < MAP_PHOTO_MAX_PAGES) {
          setStatusText(`Laster bilder ... side ${pagesLoaded + 1}`);
          const pageQuery: Record<string, string | number | boolean> = {
            date: latestFilteredDate,
            mode: "cumulative",
            include_analysis: false,
            limit: MAP_PHOTO_PAGE_LIMIT,
            sort: "desc",
          };
          if (cursor) {
            pageQuery.cursor = cursor;
          }

          const { data, requestId } = await trackRequest(() =>
            apiGet<PhotosPageResponse>("/api/v1/photos/page", {
              query: pageQuery,
              signal: abortController.signal,
              timeoutMs: MAP_PHOTO_TIMEOUT_MS,
              cache: false,
              dedupe: false,
            }),
          );

          if (seq !== photoLoadSeqRef.current || abortController.signal.aborted) return;

          lastRequestId = requestId;
          pagesLoaded += 1;

          const filteredPage = data.photos.filter(matchesClientFilters);
          mergedPhotos = mergePhotoPages(mergedPhotos, filteredPage);
          setPhotoPool(mergedPhotos);

          const oldestYearInPage = data.photos.reduce<number | null>((oldest, photo) => {
            const dateParts = splitCapturedDate(photo.captured_date);
            if (!dateParts) return oldest;
            const yearNumber = Number(dateParts.year);
            if (!Number.isFinite(yearNumber)) return oldest;
            if (oldest == null || yearNumber < oldest) return yearNumber;
            return oldest;
          }, null);

          const shouldStopForSelectedYear =
            selectedYear !== "all" &&
            oldestYearInPage != null &&
            Number.isFinite(Number(selectedYear)) &&
            oldestYearInPage < Number(selectedYear);

          cursor = data.next_cursor ?? null;
          hasMore = Boolean(cursor) && !shouldStopForSelectedYear;
        }

        if (mergedPhotos.length === 0 && filteredTimelineHasData && !showOnlyManualQc && !showOnlyLowConfidence) {
          const recovered = await loadFallbackPhotos("paged_load_returned_empty");
          if (recovered) {
            return;
          }
        }

        setPhotosLoadFailed(false);
        addLog("info", "Bilder lastet", lastRequestId, {
          apiDate: latestFilteredDate,
          count: mergedPhotos.length,
          pages: pagesLoaded,
          year: selectedYear,
          season: selectedSeason,
        });
      } catch (error) {
        const apiError = error as ApiError;
        if (seq !== photoLoadSeqRef.current) return;
        if (isRequestAborted(apiError) || abortController.signal.aborted) {
          return;
        }
        try {
          const recovered = await loadFallbackPhotos(apiError.status === 404 ? "photos_page_missing" : "photos_page_failed");
          if (recovered) {
            return;
          }
        } catch (fallbackError) {
          const fallbackApiError = fallbackError as ApiError;
          if (seq !== photoLoadSeqRef.current || abortController.signal.aborted) return;
          if (isRequestAborted(fallbackApiError)) return;
          setPhotosLoadFailed(true);
          setStatusText(`Kunne ikke laste bilder: ${fallbackApiError.message}`);
          addLog("error", "Bildelasting fallback feilet", fallbackApiError.requestId, fallbackApiError.detail);
          return;
        }

        setPhotosLoadFailed(true);
        setStatusText(`Kunne ikke laste bilder: ${apiError.message}`);
        addLog("error", "Bildelasting feilet", apiError.requestId, apiError.detail);
      }
    };

    void loadPhotos();

    return () => {
      abortController.abort();
    };
  }, [
    addLog,
    latestFilteredDate,
    photoLoadRetryToken,
    selectedSeason,
    selectedYear,
    showOnlyManualQc,
    showOnlyLowConfidence,
    trackRequest,
    filteredTimelineHasData,
  ]);

  const loadAlbumPage = useCallback(
    async (
      { reset }: { reset: boolean },
      options?: {
        signal?: AbortSignal;
      },
    ) => {
      if (!latestTimelineDate) {
        setAlbumPhotos([]);
        setAlbumCursor(null);
        setAlbumHasMore(false);
        setAlbumLoadedDate(null);
        setAlbumLoadFailed(false);
        return;
      }

      const seq = ++albumLoadSeqRef.current;
      const requestController = options?.signal
        ? null
        : (() => {
            albumAbortRef.current?.abort();
            const next = new AbortController();
            albumAbortRef.current = next;
            return next;
          })();
      const signal = requestController?.signal ?? options?.signal;

      if (reset) {
        if (albumLoadingInitial) return;
        setAlbumLoadingInitial(true);
        setAlbumLoadedDate(latestTimelineDate);
      } else {
        if (albumLoadingMore || !albumHasMore) return;
        setAlbumLoadingMore(true);
      }
      setAlbumLoadFailed(false);

      const cursor = reset ? null : albumCursor;
      const pageQuery: Record<string, string | number | boolean> = {
        date: latestTimelineDate,
        mode: "cumulative",
        include_analysis: false,
        limit: 120,
        sort: "asc",
      };
      if (cursor) {
        pageQuery.cursor = cursor;
      }

      try {
        const { data, requestId } = await trackRequest(() =>
          apiGet<PhotosPageResponse>("/api/v1/photos/page", {
            query: pageQuery,
            signal,
          }),
        );

        if (seq !== albumLoadSeqRef.current || signal?.aborted) return;

        const pagePhotos = data.photos.filter(
          (photo) =>
            (!showOnlyManualQc || photo.needs_manual_qc) &&
            (!showOnlyLowConfidence ||
              photo.confidence_score == null ||
              photo.confidence_score <= CONFIDENCE_FILTER_THRESHOLD),
        );

        setAlbumPhotos((previous) => {
          if (reset) return pagePhotos;
          return mergePhotoPages(previous, pagePhotos);
        });
        setAlbumCursor(data.next_cursor ?? null);
        setAlbumHasMore(Boolean(data.next_cursor));
        setAlbumLoadFailed(false);
        addLog("info", reset ? "Album side 1 lastet" : "Albumside lastet", requestId, {
          count: data.count,
          nextCursor: Boolean(data.next_cursor),
          date: latestTimelineDate,
        });
      } catch (error) {
        const apiError = error as ApiError;
        if (seq !== albumLoadSeqRef.current || signal?.aborted) return;
        if (apiError.status === 404) {
          try {
            const { data, requestId } = await trackRequest(() =>
              apiGet<PhotosResponse>("/api/v1/photos", {
                query: {
                  date: latestTimelineDate,
                  mode: "cumulative",
                  include_analysis: false,
                },
                signal,
              }),
            );
            if (seq !== albumLoadSeqRef.current || signal?.aborted) return;

            const ordered = [...data.photos]
              .filter(
                (photo) =>
                  (!showOnlyManualQc || photo.needs_manual_qc) &&
                  (!showOnlyLowConfidence ||
                    photo.confidence_score == null ||
                    photo.confidence_score <= CONFIDENCE_FILTER_THRESHOLD),
              )
              .sort(compareByCapturedAtThenId);
            setAlbumPhotos(ordered);
            setAlbumCursor(null);
            setAlbumHasMore(false);
            setAlbumLoadFailed(false);
            setAlbumLoadedDate(latestTimelineDate);
            addLog("warn", "Backend mangler /photos/page, bruker fallback for album", requestId, {
              count: ordered.length,
              date: latestTimelineDate,
            });
            return;
          } catch (fallbackError) {
            if (seq !== albumLoadSeqRef.current) return;
            const fallbackApiError = fallbackError as ApiError;
            setAlbumLoadFailed(true);
            addLog("error", "Albumfallback feilet", fallbackApiError.requestId, fallbackApiError.detail);
            return;
          }
        }

        setAlbumLoadFailed(true);
        addLog("error", "Albumlasting feilet", apiError.requestId, apiError.detail);
      } finally {
        if (seq === albumLoadSeqRef.current) {
          if (reset) {
            setAlbumLoadingInitial(false);
          } else {
            setAlbumLoadingMore(false);
          }
        }
      }
    },
    [
      addLog,
      albumCursor,
      albumHasMore,
      albumLoadingInitial,
      albumLoadingMore,
      showOnlyManualQc,
      showOnlyLowConfidence,
      latestTimelineDate,
      trackRequest,
    ],
  );

  useEffect(() => {
    setAlbumPhotos([]);
    setAlbumCursor(null);
    setAlbumHasMore(Boolean(latestTimelineDate));
    setAlbumLoadedDate(null);
    setAlbumLoadFailed(false);
    setAlbumLoadingInitial(false);
    setAlbumLoadingMore(false);
}, [latestTimelineDate, showOnlyManualQc, showOnlyLowConfidence]);

  useEffect(() => {
    if (activeView !== "album") return;
    if (!latestTimelineDate) return;

    if (albumLoadedDate !== latestTimelineDate) {
      void loadAlbumPage({ reset: true });
    }
  }, [activeView, albumLoadedDate, latestTimelineDate, loadAlbumPage]);

  useEffect(() => {
    if (photosLoadFailed || !latestFilteredDate) {
      return;
    }

    setStatusText(buildPhotoStatusText(photos.length, selectedYear, selectedSeason, dayScope, selectedDate));
  }, [dayScope, latestFilteredDate, photos.length, photosLoadFailed, selectedDate, selectedSeason, selectedYear]);

  useEffect(() => {
    if (photos.length === 0) {
      setSelectedPhotoId(null);
      return;
    }

    if (!syncSelectionToUrl && !hasExplicitDeepLink) {
      return;
    }

    setSelectedPhotoId((previous) => {
      if (initialPhotoRef.current && photos.some((photo) => photoIdKey(photo.id) === photoIdKey(initialPhotoRef.current))) {
        const first = initialPhotoRef.current;
        initialPhotoRef.current = null;
        return first;
      }
      initialPhotoRef.current = null;

      if (previous && photos.some((photo) => photoIdKey(photo.id) === photoIdKey(previous))) {
        return previous;
      }

      return photos[photos.length - 1]?.id ?? null;
    });
  }, [photos, hasExplicitDeepLink, syncSelectionToUrl]);

  useEffect(() => {
    if (!selectedDate || photos.length === 0) return;
    if (!syncSelectionToUrl && !hasExplicitDeepLink) return;
    const inSelectedDate = photos.filter((photo) => photo.captured_date === selectedDate);
    if (inSelectedDate.length === 0) return;

    setSelectedPhotoId((previous) => {
      if (previous && inSelectedDate.some((photo) => photoIdKey(photo.id) === photoIdKey(previous))) {
        return previous;
      }
      return inSelectedDate[inSelectedDate.length - 1].id;
    });
  }, [photos, selectedDate, hasExplicitDeepLink, syncSelectionToUrl]);

  useEffect(() => {
    if (!profile?.property || !showPropertyLayer) {
      return;
    }

    void loadGardskartJob(false);
  }, [loadGardskartJob, profile?.property, showPropertyLayer]);

  useEffect(() => {
    const next = new URLSearchParams(window.location.search);

    if (activeView === "album") {
      next.set("view", "album");
    } else {
      next.delete("view");
    }

    if (selectedDate) {
      if (syncSelectionToUrl) {
        next.set("date", selectedDate);
      } else {
        next.delete("date");
      }
    } else {
      next.delete("date");
    }

    if (!syncSelectionToUrl) {
      next.delete("photo");
    } else if (selectedPhotoId) {
      next.set("photo", selectedPhotoId);
    } else {
      next.delete("photo");
    }

    const query = next.toString();
    const target = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    window.history.replaceState({}, "", target);
  }, [activeView, selectedDate, selectedPhotoId, syncSelectionToUrl]);

  const handleSaveProfile = async (payload: {
    user: {
      full_name?: string;
      phone?: string;
      email?: string;
      address_line1?: string;
      postal_code?: string;
      city?: string;
      municipality_code?: string;
      municipality_name?: string;
    };
    property: {
      komm?: string;
      gnr?: number;
      bnr?: number;
      fnr?: number;
      label?: string;
    };
  }) => {
    const { data, requestId } = await trackRequest(() =>
      apiPatch<ProfileResponse>("/api/v1/profile/current", payload),
    );
    setProfile(data);
    addLog("info", "Profil oppdatert", requestId, { userId: data.user.id });

    const timelineData = await loadTimeline();
    if (selectedDate) {
      const idx = timelineData.dates.findIndex((entry) => entry.date === selectedDate);
      if (idx >= 0) setSelectedIndex(idx);
    }

    if (showPropertyLayer) {
      await loadGardskartJob(true);
    }
  };

  const handlePropertyTileError = useCallback(
    (jobId: string) => {
      if (tileRetryJobRef.current === jobId) {
        addLog("warn", "Tile-feil kom igjen etter auto-refresh", null, { jobId });
        return;
      }

      tileRetryJobRef.current = jobId;
      addLog("warn", "Tile-feil i eiendomslag, prøver auto-refresh", null, { jobId });
      void loadGardskartJob(true);
    },
    [addLog, loadGardskartJob],
  );

  const handleLoadMoreAlbum = useCallback(() => {
    if (!latestTimelineDate) return;
    if (albumLoadedDate !== latestTimelineDate) {
      void loadAlbumPage({ reset: true });
      return;
    }

    if (albumLoadFailed && albumPhotos.length === 0) {
      void loadAlbumPage({ reset: true });
      return;
    }

    if (!albumHasMore) return;
    void loadAlbumPage({ reset: false });
  }, [
    albumHasMore,
    albumLoadFailed,
    albumLoadedDate,
    albumPhotos.length,
    latestTimelineDate,
    loadAlbumPage,
  ]);

  const handleRetryPhotoLoad = useCallback(() => {
    setPhotosLoadFailed(false);
    setStatusText("Prøver å laste bilder på nytt ...");
    addLog("warn", "Manuell retry av bildelasting");
    setPhotoLoadRetryToken((value) => value + 1);
  }, [addLog]);

  const handleToggleManualQcFilter = useCallback((next: boolean) => {
    setShowOnlyManualQc(next);
    setSelectedPhotoId(null);
    setMapNavigationAnchorId(null);
  }, []);

  const handleToggleLowConfidenceFilter = useCallback((next: boolean) => {
    setShowOnlyLowConfidence(next);
    setSelectedPhotoId(null);
    setMapNavigationAnchorId(null);
  }, []);

  const handleAlbumScrollActivity = useCallback(() => {
    if (activeView !== "album") return;
    setAlbumScrollSpin(true);
    if (albumScrollSpinTimeoutRef.current) {
      window.clearTimeout(albumScrollSpinTimeoutRef.current);
    }
    albumScrollSpinTimeoutRef.current = window.setTimeout(() => {
      setAlbumScrollSpin(false);
      albumScrollSpinTimeoutRef.current = null;
    }, 180);
  }, [activeView]);

  useEffect(() => {
    return () => {
      if (albumScrollSpinTimeoutRef.current) {
        window.clearTimeout(albumScrollSpinTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (activeView === "album") return;
    setAlbumScrollSpin(false);
    if (albumScrollSpinTimeoutRef.current) {
      window.clearTimeout(albumScrollSpinTimeoutRef.current);
      albumScrollSpinTimeoutRef.current = null;
    }
  }, [activeView]);

  return (
    <div className={`relative h-screen overflow-hidden bg-canvas ${uiTheme === "satellite" ? "map-ui-satellite" : "map-ui-standard"}`}>
      {isPhotoViewerOpen ? (
        <div
          className="photo-viewer-overlay fixed inset-0 z-[1300]"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              handleClosePhotoViewer();
            }
          }}
        >
          <div className="photo-viewer-shell h-full w-full p-2 sm:p-4">
            <div className="photo-viewer-stage pointer-events-auto h-full w-full overflow-hidden rounded-[22px] border border-[#f4e6d1]/45">
              <div className="photo-viewer-layout h-full">
                {selectedPhoto ? (
                  <>
                    <div className="photo-viewer-image-pane relative">
                      <img
                        src={selectedPhoto.image_url || selectedPhoto.thumbnail_url || ""}
                        alt=""
                        aria-hidden="true"
                        className="photo-viewer-backdrop pointer-events-none absolute inset-0 h-full w-full object-cover"
                      />

                      <div className="photo-viewer-image-wrap relative h-full w-full">
                        <img
                          src={selectedPhoto.image_url || selectedPhoto.thumbnail_url || ""}
                          alt={selectedPhoto.title || "Foto"}
                          className="photo-viewer-image h-full w-full cursor-zoom-out object-contain"
                          onClick={handleClosePhotoViewer}
                          title="Trykk for å lukke fullskjerm"
                        />
                      </div>

                      <div className="photo-viewer-strip-wrap">
                        <div className="photo-viewer-strip">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="photo-viewer-strip-nav"
                            onClick={() => stepSelectedPhoto(-1)}
                            disabled={!hasPrevPhoto}
                            aria-label="Forrige bilde"
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </Button>

                          <div className="photo-viewer-strip-list">
                            {stripPhotos.map((photo) => {
                              const active = photoIdKey(photo.id) === photoIdKey(selectedPhoto.id);
                              const thumb = photo.thumbnail_url || photo.image_url || "";
                              return (
                                <button
                                  key={photo.id}
                                  type="button"
                                  className={`photo-viewer-strip-item ${active ? "is-active" : ""}`}
                                  onClick={() => selectPhoto(photo.id)}
                                  aria-label={`Åpne ${photo.title || "foto"}`}
                                  aria-current={active ? "true" : undefined}
                                >
                                  {thumb ? (
                                    <img src={thumb} alt={photo.title || "Foto"} loading="lazy" decoding="async" />
                                  ) : (
                                    <span className="photo-viewer-strip-empty">Bilde</span>
                                  )}
                                </button>
                              );
                            })}
                          </div>

                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="photo-viewer-strip-nav"
                            onClick={() => stepSelectedPhoto(1)}
                            disabled={!hasNextPhoto}
                            aria-label="Neste bilde"
                          >
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>

                    <aside className="photo-viewer-meta-column">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[11px] uppercase tracking-[0.08em] text-earth-700/90">Foto</p>
                          <h2 className="text-base font-semibold text-earth-950">{selectedPhoto.title || "Foto"}</h2>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Button
                            variant={metadataEditMode ? "default" : "ghost"}
                            size="icon"
                            className="h-8 w-8 shrink-0 rounded-lg border border-earth-500/30 bg-white/80 text-earth-900 hover:bg-white"
                            onClick={() => setMetadataEditMode((value) => !value)}
                            aria-label={metadataEditMode ? "Avslutt redigering" : "Rediger metadata"}
                            aria-pressed={metadataEditMode}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0 rounded-lg border border-earth-500/30 bg-white/80 text-earth-900 hover:bg-white"
                            onClick={handleClosePhotoViewer}
                            aria-label="Lukk bildevisning"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>

                      <div className="mt-3 space-y-2.5">
                        <div className="rounded-xl border border-earth-500/20 bg-white/75 p-2 text-earth-900">
                          <p className="text-[11px] uppercase tracking-[0.08em] text-earth-700/90">Analyse</p>
                          <dl className="mt-2 grid gap-1.5 text-xs text-earth-950">
                            <div className="flex items-start justify-between gap-2">
                              <dt>AR5</dt>
                              <dd className="font-medium">{selectedPhoto.analysis?.ar5_class ?? "Ikke beregnet"}</dd>
                            </div>
                            <div className="flex items-start justify-between gap-2">
                              <dt>Jordsmonn</dt>
                              <dd className="font-medium">{selectedPhoto.analysis?.soil_class ?? "Ikke beregnet"}</dd>
                            </div>
                            <div className="flex items-start justify-between gap-2">
                              <dt>Posisjon</dt>
                              <dd className="font-medium">
                                {selectedPhoto.analysis?.geometry_method
                                  ? formatGeometryMethod(selectedPhoto.analysis.geometry_method)
                                  : "Ikke beregnet"}
                              </dd>
                            </div>
                            <div className="flex items-start justify-between gap-2">
                              <dt>Confidence</dt>
                              <dd className="font-medium">
                                {selectedPhoto.analysis?.confidence == null
                                  ? "Ikke beregnet"
                                  : `${formatConfidence(selectedPhoto.analysis.confidence)} (${getAnalysisToneText(selectedPhoto.analysis.confidence)})`}
                              </dd>
                            </div>
                          </dl>
                          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                            <Button
                              type="button"
                              size="sm"
                              variant={selectedPhoto.analysis?.approved ? "outline" : "default"}
                              onClick={() => void handlePhotoAnalysisAction(selectedPhoto.id, "approve")}
                              disabled={
                                analysisBusyPhotoId === selectedPhoto.id ||
                                !selectedPhoto.analysis ||
                                Boolean(selectedPhoto.analysis?.approved)
                              }
                              className="h-8"
                            >
                              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                              Godkjenn posisjon
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => void handlePhotoAnalysisAction(selectedPhoto.id, "recompute")}
                              disabled={analysisBusyPhotoId === selectedPhoto.id}
                              className="h-8"
                            >
                              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                              {selectedPhoto.analysis ? "Reberegn" : "Beregn nå"}
                            </Button>
                          </div>
                        </div>

                        <div className="rounded-xl border border-earth-500/20 bg-white/75 p-2 text-earth-900">
                          <p className="text-[11px] uppercase tracking-[0.08em] text-earth-700/90">Nøkkelinformasjon</p>
                          <dl className="mt-2 grid gap-1.5 text-xs text-earth-950">
                            <div className="flex items-start justify-between gap-2">
                              <dt>Dato/tid</dt>
                              <dd className="text-right font-medium">{formatCapturedAt(selectedPhoto.captured_at)}</dd>
                            </div>
                            <div className="flex items-start justify-between gap-2">
                              <dt>Koordinater</dt>
                              <dd className="text-right font-medium">
                                {formatCoordinate(selectedPhoto.lat)}, {formatCoordinate(selectedPhoto.lng)}
                              </dd>
                            </div>
                            <div className="flex items-start justify-between gap-2">
                              <dt>Målpunkt</dt>
                              <dd className="text-right font-medium">
                                {selectedPhoto.view_lat == null || selectedPhoto.view_lng == null
                                  ? "ikke estimert"
                                  : `${formatCoordinate(selectedPhoto.view_lat)}, ${formatCoordinate(selectedPhoto.view_lng)}`}
                              </dd>
                            </div>
                            <div className="flex items-start justify-between gap-2">
                              <dt>QC-score</dt>
                              <dd className="text-right font-medium">
                                {formatConfidence(selectedPhoto.confidence_score)}
                                {selectedPhoto.needs_manual_qc ? " (manual review)" : ""}
                              </dd>
                            </div>
                          </dl>
                        </div>

                        <div className="rounded-xl border border-earth-500/20 bg-white/75 p-2 text-earth-900">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[11px] uppercase tracking-[0.08em] text-earth-700/90">Metadata</p>
                            <span className="rounded-full border border-earth-500/25 bg-white/80 px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-earth-800">
                              {metadataEditMode ? "Redigering" : "Lesemodus"}
                            </span>
                          </div>

                          <dl className="mt-2 grid gap-2 text-xs text-earth-950">
                            <div className="flex items-center justify-between gap-2">
                              <dt>Høyde (m)</dt>
                              <dd className="w-28">
                                {metadataEditMode ? (
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    className="h-8 w-full rounded-lg border border-earth-500/30 bg-white/78 px-2 text-right text-xs text-earth-950 outline-none focus-visible:ring-2 focus-visible:ring-earth-700/30"
                                    value={metadataAltitudeDraft}
                                    placeholder="ukjent"
                                    onChange={(event) => setMetadataAltitudeDraft(event.target.value)}
                                    disabled={metadataBusyPhotoId === selectedPhoto.id}
                                  />
                                ) : (
                                  <span className="block text-right font-medium">
                                    {selectedPhoto.altitude_m == null ? "ukjent" : `${selectedPhoto.altitude_m} m`}
                                  </span>
                                )}
                              </dd>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <dt>Retning (deg)</dt>
                              <dd className="w-28">
                                {metadataEditMode ? (
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    className="h-8 w-full rounded-lg border border-earth-500/30 bg-white/78 px-2 text-right text-xs text-earth-950 outline-none focus-visible:ring-2 focus-visible:ring-earth-700/30"
                                    value={metadataHeadingDraft}
                                    placeholder="ukjent"
                                    onChange={(event) => setMetadataHeadingDraft(event.target.value)}
                                    disabled={metadataBusyPhotoId === selectedPhoto.id}
                                  />
                                ) : (
                                  <span className="block text-right font-medium">
                                    {selectedPhoto.heading_deg == null ? "ukjent" : `${selectedPhoto.heading_deg}°`}
                                  </span>
                                )}
                              </dd>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <dt>Pitch (deg)</dt>
                              <dd className="w-28">
                                {metadataEditMode ? (
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    className="h-8 w-full rounded-lg border border-earth-500/30 bg-white/78 px-2 text-right text-xs text-earth-950 outline-none focus-visible:ring-2 focus-visible:ring-earth-700/30"
                                    value={metadataPitchDraft}
                                    placeholder="ukjent"
                                    onChange={(event) => setMetadataPitchDraft(event.target.value)}
                                    disabled={metadataBusyPhotoId === selectedPhoto.id}
                                  />
                                ) : (
                                  <span className="block text-right font-medium">
                                    {selectedPhoto.pitch_deg == null ? "ukjent" : `${selectedPhoto.pitch_deg}°`}
                                  </span>
                                )}
                              </dd>
                            </div>
                            <div className="flex items-start justify-between gap-2">
                              <dt>Manuell QC</dt>
                              <dd className="text-right">
                                {metadataEditMode ? (
                                  <label className="inline-flex items-center gap-2 text-xs text-earth-900">
                                    <input
                                      type="checkbox"
                                      checked={metadataNeedsManualQcDraft}
                                      onChange={(event) => {
                                        setMetadataNeedsManualQcDraft(event.currentTarget.checked);
                                      }}
                                      disabled={metadataBusyPhotoId === selectedPhoto.id}
                                    />
                                    Må vurderes manuelt
                                  </label>
                                ) : (
                                  <span className="font-medium">
                                    {selectedPhoto.needs_manual_qc ? "Må vurderes manuelt" : "OK"}
                                  </span>
                                )}
                              </dd>
                            </div>
                            <div className="flex items-start justify-between gap-2">
                              <dt>Målpunkt</dt>
                              <dd className="max-w-[14rem] text-right">
                                {metadataEditMode ? (
                                  <div className="space-y-1">
                                    <p className="text-[11px] text-earth-700/90">Klikk i kartet eller dra punktet</p>
                                    <p className="font-medium">
                                      {metadataManualViewTargetDraft
                                        ? `${formatCoordinate(metadataManualViewTargetDraft.lat)}, ${formatCoordinate(metadataManualViewTargetDraft.lng)}`
                                        : "Beregnet automatisk"}
                                    </p>
                                    <div className="flex justify-end">
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="h-7 text-[11px]"
                                        onClick={() => setMetadataManualViewTargetDraft(null)}
                                        disabled={metadataBusyPhotoId === selectedPhoto.id}
                                      >
                                        Bruk beregnet punkt
                                      </Button>
                                    </div>
                                  </div>
                                ) : (
                                  <span className="font-medium">
                                    {selectedPhotoManualViewTarget
                                      ? `${formatCoordinate(selectedPhotoManualViewTarget.lat)}, ${formatCoordinate(selectedPhotoManualViewTarget.lng)}`
                                      : "Beregnet automatisk"}
                                  </span>
                                )}
                              </dd>
                            </div>
                          </dl>

                          <div className="mt-2 space-y-2">
                            <p className="text-[11px] uppercase tracking-[0.08em] text-earth-700/90">Tags</p>
                            <div className="flex flex-wrap gap-1.5">
                              {metadataTagsDraft.length > 0 ? (
                                metadataTagsDraft.map((tag) => (
                                  <span
                                    key={tag}
                                    className="inline-flex items-center gap-1 rounded-full border border-earth-500/28 bg-white/76 px-2.5 py-1 text-xs text-earth-900"
                                  >
                                    {tag}
                                    {metadataEditMode ? (
                                      <button
                                        type="button"
                                        className="rounded text-earth-700 hover:text-earth-950"
                                        aria-label={`Fjern tag ${tag}`}
                                        onClick={() =>
                                          setMetadataTagsDraft((previous) =>
                                            previous.filter((item) => item.toLocaleLowerCase("nb-NO") !== tag.toLocaleLowerCase("nb-NO")),
                                          )
                                        }
                                        disabled={metadataBusyPhotoId === selectedPhoto.id}
                                      >
                                        ×
                                      </button>
                                    ) : null}
                                  </span>
                                ))
                              ) : (
                                <span className="text-xs text-earth-700/85">Ingen tags ennå</span>
                              )}
                            </div>
                            {metadataEditMode ? (
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  className="h-8 flex-1 rounded-lg border border-earth-500/30 bg-white/78 px-2 text-xs text-earth-950 outline-none focus-visible:ring-2 focus-visible:ring-earth-700/30"
                                  placeholder="Ny tag"
                                  value={metadataTagDraft}
                                  onChange={(event) => setMetadataTagDraft(event.target.value)}
                                  onKeyDown={(event) => {
                                    if (event.key !== "Enter") return;
                                    event.preventDefault();
                                    const nextTag = metadataTagDraft.trim();
                                    if (!nextTag) return;
                                    setMetadataTagsDraft((previous) => normalizeTagsInput([...previous, nextTag]));
                                    setMetadataTagDraft("");
                                  }}
                                  disabled={metadataBusyPhotoId === selectedPhoto.id}
                                />
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-8"
                                  onClick={() => {
                                    const nextTag = metadataTagDraft.trim();
                                    if (!nextTag) return;
                                    setMetadataTagsDraft((previous) => normalizeTagsInput([...previous, nextTag]));
                                    setMetadataTagDraft("");
                                  }}
                                  disabled={!metadataTagDraft.trim() || metadataBusyPhotoId === selectedPhoto.id}
                                >
                                  Legg til
                                </Button>
                              </div>
                            ) : null}
                          </div>

                          <div className="mt-2 space-y-2">
                            <p className="text-[11px] uppercase tracking-[0.08em] text-earth-700/90">Notat</p>
                            {metadataEditMode ? (
                              <textarea
                                className="min-h-[72px] w-full rounded-xl border border-earth-500/20 bg-white/75 p-2 text-sm text-earth-900 outline-none focus-visible:ring-2 focus-visible:ring-earth-700/30"
                                value={metadataCaptionDraft}
                                placeholder="Skriv notat ..."
                                onChange={(event) => setMetadataCaptionDraft(event.target.value)}
                                disabled={metadataBusyPhotoId === selectedPhoto.id}
                              />
                            ) : (
                              <p className="rounded-lg border border-earth-500/20 bg-white/70 p-2 text-xs text-earth-900">
                                {selectedPhoto.caption && selectedPhoto.caption.trim() ? selectedPhoto.caption : "Ingen notat."}
                              </p>
                            )}
                          </div>

                          {metadataEditMode ? (
                            <div className="mt-2 flex items-center gap-1.5">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8"
                                onClick={handleCancelMetadataEdit}
                                disabled={metadataBusyPhotoId === selectedPhoto.id}
                              >
                                Avbryt
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="default"
                                className="h-8"
                                onClick={() => void handleSavePhotoMetadata()}
                                disabled={!hasMetadataChanges || metadataBusyPhotoId === selectedPhoto.id}
                              >
                                Lagre metadata
                              </Button>
                            </div>
                          ) : null}
                        </div>

                        <div className="rounded-xl border border-earth-500/20 bg-white/75 p-2 text-earth-900">
                          <p className="text-[11px] uppercase tracking-[0.08em] text-earth-700/90">Kartutsnitt</p>
                          <div className="mt-1">
                            <PhotoMapInset
                              photo={selectedPhoto}
                              baseMapStyle={baseMapStyle}
                              editable={metadataEditMode}
                              manualTarget={activeInsetManualTarget}
                              onManualTargetChange={setMetadataManualViewTargetDraft}
                            />
                          </div>
                        </div>

                        <div className="rounded-xl border border-earth-500/20 bg-white/75 p-2 text-earth-900">
                          <button
                            type="button"
                            className="flex w-full items-center justify-between text-left"
                            onClick={() => setShowTechnicalMetadata((value) => !value)}
                          >
                            <span className="text-[11px] uppercase tracking-[0.08em] text-earth-700/90">Teknisk metadata</span>
                            <span className="text-[11px] text-earth-800">{showTechnicalMetadata ? "Skjul" : "Vis"}</span>
                          </button>
                          {showTechnicalMetadata ? (
                            <dl className="mt-2 grid gap-1.5 text-xs text-earth-950">
                              <div className="flex items-start justify-between gap-2">
                                <dt>Dato</dt>
                                <dd className="text-right font-medium">{selectedPhoto.captured_date}</dd>
                              </div>
                              <div className="flex items-start justify-between gap-2">
                                <dt>Heading-kilde</dt>
                                <dd className="text-right font-medium">{formatQCRating(selectedPhoto.heading_source)}</dd>
                              </div>
                              <div className="flex items-start justify-between gap-2">
                                <dt>Pitch-kilde</dt>
                                <dd className="text-right font-medium">{formatQCRating(selectedPhoto.pitch_source)}</dd>
                              </div>
                              <div className="flex items-start justify-between gap-2">
                                <dt>GSD</dt>
                                <dd className="text-right font-medium">{formatGsd(selectedPhoto.gsd_m)}</dd>
                              </div>
                              <div className="flex items-start justify-between gap-2">
                                <dt>Bildeavtrykk</dt>
                                <dd className="text-right font-medium">{formatMeters(selectedPhoto.image_footprint_w_m)}</dd>
                              </div>
                              <div className="flex items-start justify-between gap-2">
                                <dt>Track spacing</dt>
                                <dd className="text-right font-medium">{formatMeters(selectedPhoto.track_spacing_m)}</dd>
                              </div>
                              <div className="flex items-start justify-between gap-2">
                                <dt>Planlagt overlap</dt>
                                <dd className="text-right font-medium">
                                  Front {formatPercent(selectedPhoto.overlap_front)} / Side {formatPercent(selectedPhoto.overlap_side)}
                                </dd>
                              </div>
                              {selectedPhoto.coverage_profile ? (
                                <div className="flex items-start justify-between gap-2">
                                  <dt>Overlapp-kontroll</dt>
                                  <dd className="text-right font-medium">
                                    {selectedPhoto.coverage_profile.actual_front == null && selectedPhoto.coverage_profile.actual_side == null
                                      ? "Måles fra kamerarekke"
                                      : `Front ${formatPercent(selectedPhoto.coverage_profile.actual_front)} / Side ${formatPercent(selectedPhoto.coverage_profile.actual_side)}`}
                                    {` (${selectedPhoto.coverage_profile.quality})`}
                                    {selectedPhoto.coverage_profile.neighbor_count == null
                                      ? ""
                                      : ` · naboer ${selectedPhoto.coverage_profile.neighbor_count}`}
                                  </dd>
                                </div>
                              ) : null}
                              <div className="flex items-start justify-between gap-2">
                                <dt>Oblique-korreksjon</dt>
                                <dd className="text-right font-medium">
                                  {selectedPhoto.oblique_correction_applied == null
                                    ? "ukjent"
                                    : selectedPhoto.oblique_correction_applied
                                      ? "Ja"
                                      : "Nei"}
                                </dd>
                              </div>
                              <div className="flex items-start justify-between gap-2">
                                <dt>Analyse-sone</dt>
                                <dd className="text-right font-medium">
                                  {selectedPhoto.analysis_zone?.sampling_strategy?.type ?? "ingen"}
                                  {selectedPhoto.analysis_zone?.sampling_strategy?.radius_m == null
                                    ? ""
                                    : ` · ${selectedPhoto.analysis_zone.sampling_strategy.radius_m} m`}
                                </dd>
                              </div>
                              <div className="flex items-start justify-between gap-2">
                                <dt>5-punkts målepunkter</dt>
                                <dd className="text-right font-medium">
                                  {selectedPhoto.analysis_zone?.sample_points?.length ?? 0}
                                </dd>
                              </div>
                              <div className="flex items-start justify-between gap-2">
                                <dt>Usikkerhets-radius</dt>
                                <dd className="text-right font-medium">{formatMeters(selectedPhoto.location_uncertainty_m)}</dd>
                              </div>
                              {selectedPhoto.confidence_reasons.length > 0 ? (
                                <div className="flex items-start justify-between gap-2">
                                  <dt>QC-grunner</dt>
                                  <dd className="max-w-[13rem] text-right font-medium">
                                    <span className="text-xs">{selectedPhoto.confidence_reasons.join(", ")}</span>
                                  </dd>
                                </div>
                              ) : null}
                              <div className="flex items-start justify-between gap-2">
                                <dt>Photo-ID</dt>
                                <dd className="max-w-[13rem] break-all text-right font-medium">{selectedPhoto.id}</dd>
                              </div>
                            </dl>
                          ) : null}
                        </div>
                      </div>
                    </aside>
                  </>
                ) : (
                  <>
                    <div className="photo-viewer-image-pane relative">
                      <div className="photo-viewer-strip-wrap">
                        <div className="photo-viewer-strip">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="photo-viewer-strip-nav"
                            onClick={() => stepSelectedPhoto(-1)}
                            disabled={!hasPrevPhoto}
                            aria-label="Forrige bilde"
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </Button>

                          <div className="photo-viewer-strip-list">
                            {stripPhotos.map((photo) => {
                              const active = photoIdKey(photo.id) === photoIdKey(selectedPhotoId);
                              const thumb = photo.thumbnail_url || photo.image_url || "";
                              return (
                                <button
                                  key={photo.id}
                                  type="button"
                                  className={`photo-viewer-strip-item ${active ? "is-active" : ""}`}
                                  onClick={() => selectPhoto(photo.id)}
                                  aria-label={`Åpne ${photo.title || "foto"}`}
                                  aria-current={active ? "true" : undefined}
                                >
                                  {thumb ? (
                                    <img src={thumb} alt={photo.title || "Foto"} loading="lazy" decoding="async" />
                                  ) : (
                                    <span className="photo-viewer-strip-empty">Bilde</span>
                                  )}
                                </button>
                              );
                            })}
                          </div>

                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="photo-viewer-strip-nav"
                            onClick={() => stepSelectedPhoto(1)}
                            disabled={!hasNextPhoto}
                            aria-label="Neste bilde"
                          >
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>

                      <div className="photo-viewer-image-wrap relative flex items-center justify-center h-full w-full text-center">
                        <div>
                          <p className="mb-2 text-sm text-white/80">Finner valgt bilde ...</p>
                          <p className="text-xs text-white/70">
                            Photo-ID: <span className="font-mono">{selectedPhotoId ?? "ukjent"}</span>
                          </p>
                        </div>
                      </div>
                    </div>

                    <aside className="photo-viewer-meta-column">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[11px] uppercase tracking-[0.08em] text-earth-700/90">Foto</p>
                          <h2 className="text-base font-semibold text-earth-950">Laster metadata ...</h2>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0 rounded-lg border border-earth-500/30 bg-white/80 text-earth-900 hover:bg-white"
                          onClick={handleClosePhotoViewer}
                          aria-label="Lukk bildevisning"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </aside>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {activeView === "map" ? (
        <MapCanvas
          photos={photos}
          selectedPhotoId={selectedPhotoId}
          hoveredPhotoId={hoverPreviewPhotoId}
          focusToken={mapFocusToken}
          resetViewToken={mapResetToken}
          property={profile?.property ?? null}
          job={job}
          baseMapStyle={baseMapStyle}
          mapGrayscale={mapGrayscale}
          mapVintage={mapVintage}
          showPropertyLayer={showPropertyLayer}
          onSelectPhoto={handleSelectPhoto}
          onHoverPhoto={handleHoverPhoto}
          onOpenPhotoFullscreen={handleOpenPhotoViewer}
          onPropertyStatus={setPropertyStatus}
          onPropertyTileError={handlePropertyTileError}
        />
      ) : (
        <AlbumPage
          photos={albumPhotos}
          isLoading={albumLoadingInitial}
          isLoadingMore={albumLoadingMore}
          hasMore={albumHasMore}
          loadFailed={albumLoadFailed}
          onLoadMore={handleLoadMoreAlbum}
          onOpenPhoto={handleOpenPhotoViewer}
          onScrollActivity={handleAlbumScrollActivity}
        />
      )}

      {activeView === "map" && photosLoadFailed ? (
        <div className="pointer-events-none absolute left-1/2 top-3 z-[660] -translate-x-1/2 px-3">
          <div className="pointer-events-auto inline-flex flex-wrap items-center gap-2 rounded-xl border border-red-300/75 bg-white/95 px-3 py-2 text-sm text-red-900 shadow-lg">
            <span>Kunne ikke laste bilder for valgt filter.</span>
            <Button type="button" size="sm" variant="outline" onClick={handleRetryPhotoLoad}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Prøv igjen
            </Button>
          </div>
        </div>
      ) : null}

      {activeView === "map" && hoverPreviewPhoto && !isPhotoViewerOpen ? (
        <div className="pointer-events-none absolute left-1/2 top-4 z-[640] hidden -translate-x-1/2 md:block">
          <div className="overflow-hidden rounded-2xl border border-white/45 bg-black/20 p-2 shadow-[0_18px_55px_rgba(8,10,18,0.4)] backdrop-blur-xl">
            <img
              src={hoverPreviewPhoto.image_url || hoverPreviewPhoto.thumbnail_url || ""}
              alt={hoverPreviewPhoto.title || "Forhåndsvisning"}
              className="block h-auto max-h-[34vh] w-[min(52vw,760px)] min-w-[320px] rounded-xl object-cover"
              loading="lazy"
              decoding="async"
            />
          </div>
        </div>
      ) : null}

      <div className="pointer-events-none absolute inset-0 z-[700] flex flex-col">
        <SideRail
          profile={profile}
          activeView={activeView}
          uiTheme={uiTheme}
          statusText={statusText}
          propertyStatus={propertyStatus}
          showPropertyLayer={showPropertyLayer}
          baseMapStyle={baseMapStyle}
          mapGrayscale={mapGrayscale}
          mapVintage={mapVintage}
          showOnlyManualQc={showOnlyManualQc}
          showOnlyLowConfidence={showOnlyLowConfidence}
          onToggleManualQcFilter={handleToggleManualQcFilter}
          onToggleLowConfidenceFilter={handleToggleLowConfidenceFilter}
          isLoading={isLoading}
          logoSpinActive={albumScrollSpin}
          logs={logs}
          onClearLogs={() => setLogs([])}
          backendLogs={backendLogs}
          backendLogsLoading={isBackendLogsLoading}
          onClearBackendLogs={() => setBackendLogs([])}
          onFetchBackendLogs={loadBackendLogs}
          onChangeBaseMapStyle={(style) => {
            setBaseMapStyle(style);
            window.localStorage.setItem(PREF_MAP_STYLE_MANUAL_KEY, "1");
            addLog("info", "Bakgrunnskart endret", null, { style });
          }}
          onChangeMapGrayscale={(next) => {
            setMapGrayscale(next);
            addLog("info", next ? "Svart/hvitt aktivert" : "Svart/hvitt deaktivert");
          }}
          onChangeMapVintage={(next) => {
            setMapVintage(next);
            addLog("info", next ? "Vintage-kart aktivert" : "Vintage-kart deaktivert");
          }}
          onChangeView={(view) => {
            setActiveView(view);
            addLog("info", view === "album" ? "Album åpnet" : "Kart åpnet");
          }}
          onTogglePropertyLayer={(next) => {
            setShowPropertyLayer(next);
            if (!next) {
              setJob(null);
              setPropertyStatus("Eiendomslag er skrudd av.");
              addLog("info", "Eiendomslag skrudd av av bruker");
            } else {
              tileRetryJobRef.current = null;
              addLog("info", "Eiendomslag skrudd på av bruker");
            }
          }}
          onSaveProfile={handleSaveProfile}
        />

        {activeView === "map" ? (
          <TimelineBottom
            filteredDates={filteredTimeline}
            uiTheme={uiTheme}
            selectedIndex={selectedIndex}
            selectedYear={selectedYear}
            selectedSeason={selectedSeason}
            dayScope={dayScope}
            availableYears={availableYears}
            seasonCounts={seasonCounts}
            onSelectIndex={(index) => {
              setSyncSelectionToUrl(true);
              setSelectedIndex(index);
              setDayScope("selected");
              setMapResetToken((value) => value + 1);
            }}
            onYearChange={(year) => {
              setSyncSelectionToUrl(true);
              setSelectedYear(year);
              setSelectedSeason("all");
              setDayScope("all");
              setMapResetToken((value) => value + 1);
            }}
            onSeasonChange={(season) => {
              setSyncSelectionToUrl(true);
              setSelectedSeason(season);
              setDayScope("all");
              setMapResetToken((value) => value + 1);
            }}
            onDayScopeChange={(scope) => {
              setSyncSelectionToUrl(true);
              setDayScope(scope);
              setMapResetToken((value) => value + 1);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
