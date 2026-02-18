import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, RefreshCw, ChevronLeft, ChevronRight, X } from "lucide-react";

import { apiGet, apiPatch, apiPost, ApiError } from "@/lib/api";
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

const LOG_LIMIT = 220;

type SeasonFilter = "all" | "spring" | "summer" | "autumn" | "winter";
type DayScope = "all" | "selected";
type AppView = "map" | "album";
type UiTheme = "standard" | "satellite";
const CONFIDENCE_FILTER_THRESHOLD = 0.72;
const PREF_MAP_STYLE_KEY = "fb.map.baseStyle";
const PREF_MAP_STYLE_MANUAL_KEY = "fb.map.baseStyle.manual";
const PREF_MAP_GRAYSCALE_KEY = "fb.map.grayscale";
const PREF_MAP_VINTAGE_KEY = "fb.map.vintage";

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
  const [metadataTagDraft, setMetadataTagDraft] = useState("");
  const [metadataTagsDraft, setMetadataTagsDraft] = useState<string[]>([]);
  const [metadataCaptionDraft, setMetadataCaptionDraft] = useState("");
  const [metadataNeedsManualQcDraft, setMetadataNeedsManualQcDraft] = useState(false);
  const [photosLoadFailed, setPhotosLoadFailed] = useState(false);
  const [albumLoadFailed, setAlbumLoadFailed] = useState(false);
  const [albumScrollSpin, setAlbumScrollSpin] = useState(false);
  const [mapFocusToken, setMapFocusToken] = useState(0);
  const [mapResetToken, setMapResetToken] = useState(0);
  const [syncSelectionToUrl, setSyncSelectionToUrl] = useState(() => Boolean(initialDate || initialPhoto));
  const uiTheme: UiTheme = baseMapStyle === "satellite" ? "satellite" : "standard";

  const initialPhotoRef = useRef<string | null>(initialPhoto);
  const tileRetryJobRef = useRef<string | null>(null);
  const albumScrollSpinTimeoutRef = useRef<number | null>(null);

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
    return (
      JSON.stringify(currentTags) !== JSON.stringify(draftTags) ||
      currentCaption !== draftCaption ||
      Boolean(selectedPhoto.needs_manual_qc) !== metadataNeedsManualQcDraft
    );
  }, [metadataCaptionDraft, metadataNeedsManualQcDraft, metadataTagsDraft, selectedPhoto]);

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

  const loadProfile = useCallback(async (): Promise<ProfileResponse> => {
    return trackRequest(async () => {
      const { data, requestId } = await apiGet<ProfileResponse>("/api/v1/profile/current");
      setProfile(data);
      addLog("info", "Profil lastet", requestId, { userId: data.user.id });
      return data;
    });
  }, [addLog, trackRequest]);

  const loadTimeline = useCallback(async (): Promise<TimelineResponse> => {
    return trackRequest(async () => {
      const { data, requestId } = await apiGet<TimelineResponse>("/api/v1/timeline/dates");
      setTimeline(data.dates);
      addLog("info", "Tidslinje lastet", requestId, { days: data.dates.length });
      return data;
    });
  }, [addLog, trackRequest]);

  const loadBackendLogs = useCallback(async () => {
    setIsBackendLogsLoading(true);
    try {
      const { data, requestId } = await apiGet<{
        count: number;
        source: string;
        lines: BackendLogEntry[];
      }>(`/api/v1/logs?limit=120`);
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

  const updatePhotoMetadataState = useCallback((photoId: string, tags: string[], caption: string | null, needsManualQc: boolean) => {
    setPhotoPool((previous) =>
      previous.map((photo) =>
        photo.id === photoId ? { ...photo, tags, caption, needs_manual_qc: needsManualQc } : photo,
      ),
    );
    setAlbumPhotos((previous) =>
      previous.map((photo) =>
        photo.id === photoId ? { ...photo, tags, caption, needs_manual_qc: needsManualQc } : photo,
      ),
    );
  }, []);

  const loadGardskartJob = useCallback(
    async (forceRefresh: boolean) => {
      if (!profile?.property || !showPropertyLayer) {
        return;
      }

      const query = forceRefresh ? "?force_refresh=true" : "";
      try {
        const { data, requestId } = await trackRequest(() =>
          apiGet<GardskartJob>(`/api/v1/properties/current/gardskart-job${query}`),
        );
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
    [addLog, analysisBusyPhotoId, apiPost, trackRequest, updatePhotoAnalysisState],
  );

  const handleSavePhotoMetadata = useCallback(async () => {
    if (!selectedPhoto) return;
    if (metadataBusyPhotoId === selectedPhoto.id) return;

    const nextTags = normalizeTagsInput(metadataTagsDraft);
    const nextCaption = metadataCaptionDraft.trim();
    const nextNeedsManualQc = metadataNeedsManualQcDraft;

    setMetadataBusyPhotoId(selectedPhoto.id);
    try {
      const { data, requestId } = await trackRequest(() =>
        apiPatch<PhotoMetadataActionResponse>(`/api/v1/photos/${selectedPhoto.id}/metadata`, {
          tags: nextTags,
          caption: nextCaption,
          needs_manual_qc: nextNeedsManualQc,
        }),
      );

      updatePhotoMetadataState(data.photo_id, data.tags, data.caption, data.needs_manual_qc);
      setMetadataTagsDraft(data.tags);
      setMetadataCaptionDraft(data.caption ?? "");
      setMetadataNeedsManualQcDraft(data.needs_manual_qc);
      setMetadataTagDraft("");
      addLog("info", "Metadata lagret", requestId, {
        photoId: data.photo_id,
        tags: data.tags.length,
        needs_manual_qc: data.needs_manual_qc,
      });
      setStatusText("Metadata oppdatert.");
    } catch (error) {
      const apiError = error as ApiError;
      addLog("error", "Kunne ikke lagre metadata", apiError.requestId, apiError.detail);
      setStatusText("Kunne ikke lagre metadata.");
    } finally {
      setMetadataBusyPhotoId(null);
    }
  }, [
    addLog,
    apiPatch,
    metadataBusyPhotoId,
    metadataCaptionDraft,
    metadataTagsDraft,
    selectedPhoto,
    trackRequest,
    updatePhotoMetadataState,
    metadataNeedsManualQcDraft,
  ]);

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
      return;
    }
    setMetadataTagDraft("");
    setMetadataTagsDraft(selectedPhoto.tags ?? []);
    setMetadataCaptionDraft(selectedPhoto.caption ?? "");
    setMetadataNeedsManualQcDraft(selectedPhoto.needs_manual_qc);
  }, [selectedPhoto?.id]);

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
    let cancelled = false;

    const bootstrap = async () => {
      try {
        setStatusText("Laster profil og tidslinje ...");
        const [profileData, timelineData] = await Promise.all([loadProfile(), loadTimeline()]);
        if (cancelled) return;

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
      } catch (error) {
        const apiError = error as ApiError;
        setStatusText(`Oppstart feilet: ${apiError.message}`);
        addLog("error", "Oppstart feilet", apiError.requestId, apiError.detail);
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
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
    let cancelled = false;

    const loadPhotos = async () => {
      if (!latestFilteredDate) {
        setPhotoPool([]);
        setPhotosLoadFailed(false);
        setSelectedPhotoId(null);
        setStatusText("Ingen bilder for valgt filter.");
        return;
      }

      try {
        const { data, requestId } = await trackRequest(() =>
          apiGet<PhotosResponse>(
            `/api/v1/photos?date=${latestFilteredDate}&mode=cumulative&include_analysis=false`,
          ),
        );

        if (cancelled) return;

        const filteredPhotos = data.photos.filter((photo) => {
          const year = photo.captured_date.slice(0, 4);
          const month = photo.captured_date.slice(5, 7);
          if (selectedYear !== "all" && year !== selectedYear) return false;
          if (selectedSeason !== "all" && monthToSeason(month) !== selectedSeason) return false;
          if (showOnlyManualQc && !photo.needs_manual_qc) return false;
          if (
            showOnlyLowConfidence &&
            (photo.confidence_score == null || photo.confidence_score > CONFIDENCE_FILTER_THRESHOLD)
          ) {
            return false;
          }
          return true;
        });

        setPhotoPool(filteredPhotos);
        setPhotosLoadFailed(false);
        addLog("info", "Bilder lastet", requestId, {
          apiDate: latestFilteredDate,
          count: filteredPhotos.length,
          year: selectedYear,
          season: selectedSeason,
        });
      } catch (error) {
        const apiError = error as ApiError;
        if (cancelled) return;
        setPhotosLoadFailed(true);
        setStatusText(`Kunne ikke laste bilder: ${apiError.message}`);
        addLog("error", "Bildelasting feilet", apiError.requestId, apiError.detail);
      }
    };

    void loadPhotos();

    return () => {
      cancelled = true;
    };
  }, [
    addLog,
    latestFilteredDate,
    selectedSeason,
    selectedYear,
    showOnlyManualQc,
    showOnlyLowConfidence,
    trackRequest,
  ]);

  const loadAlbumPage = useCallback(
    async ({ reset }: { reset: boolean }) => {
      if (!latestTimelineDate) {
        setAlbumPhotos([]);
        setAlbumCursor(null);
        setAlbumHasMore(false);
        setAlbumLoadedDate(null);
        setAlbumLoadFailed(false);
        return;
      }

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
      const query = new URLSearchParams({
        date: latestTimelineDate,
        mode: "cumulative",
        include_analysis: "false",
        limit: "120",
        sort: "asc",
      });
      if (cursor) {
        query.set("cursor", cursor);
      }

      try {
        const { data, requestId } = await trackRequest(() =>
          apiGet<PhotosPageResponse>(`/api/v1/photos/page?${query.toString()}`),
        );

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
        if (apiError.status === 404) {
          try {
            const { data, requestId } = await trackRequest(() =>
              apiGet<PhotosResponse>(
                `/api/v1/photos?date=${latestTimelineDate}&mode=cumulative&include_analysis=false`,
              ),
            );
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
            const fallbackApiError = fallbackError as ApiError;
            setAlbumLoadFailed(true);
            addLog("error", "Albumfallback feilet", fallbackApiError.requestId, fallbackApiError.detail);
            return;
          }
        }

        setAlbumLoadFailed(true);
        addLog("error", "Albumlasting feilet", apiError.requestId, apiError.detail);
      } finally {
        if (reset) {
          setAlbumLoadingInitial(false);
        } else {
          setAlbumLoadingMore(false);
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

                      <dl className="mt-3 grid gap-2.5 text-sm">
                        <div>
                          <dt className="text-[11px] uppercase tracking-[0.08em] text-earth-700/90">Dato/tid</dt>
                          <dd className="font-medium text-earth-950">{formatCapturedAt(selectedPhoto.captured_at)}</dd>
                        </div>
                        <div>
                          <dt className="text-[11px] uppercase tracking-[0.08em] text-earth-700/90">Dato</dt>
                          <dd className="font-medium text-earth-950">{selectedPhoto.captured_date}</dd>
                        </div>
                        <div>
                          <dt className="text-[11px] uppercase tracking-[0.08em] text-earth-700/90">Koordinater</dt>
                          <dd className="font-medium text-earth-950">
                            {formatCoordinate(selectedPhoto.lat)}, {formatCoordinate(selectedPhoto.lng)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[11px] uppercase tracking-[0.08em] text-earth-700/90">Høyde</dt>
                          <dd className="font-medium text-earth-950">
                            {selectedPhoto.altitude_m == null ? "ukjent" : `${selectedPhoto.altitude_m} m`}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[11px] uppercase tracking-[0.08em] text-earth-700/90">Retning</dt>
                          <dd className="font-medium text-earth-950">
                            {selectedPhoto.heading_deg == null ? "ukjent" : `${selectedPhoto.heading_deg}°`}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[11px] uppercase tracking-[0.08em] text-earth-700/90">Vinkel (pitch)</dt>
                          <dd className="font-medium text-earth-950">
                            {selectedPhoto.pitch_deg == null ? "ukjent" : `${selectedPhoto.pitch_deg}°`}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[11px] uppercase tracking-[0.08em] text-earth-700/90">Heading-kilde</dt>
                          <dd className="font-medium text-earth-950">{formatQCRating(selectedPhoto.heading_source)}</dd>
                        </div>
                        <div>
                          <dt className="text-[11px] uppercase tracking-[0.08em] text-earth-700/90">Pitch-kilde</dt>
                          <dd className="font-medium text-earth-950">{formatQCRating(selectedPhoto.pitch_source)}</dd>
                        </div>
                        <div>
                          <dt className="text-[11px] uppercase tracking-[0.08em] text-earth-700/90">Estimat målpunkt</dt>
                          <dd className="font-medium text-earth-950">
                            {selectedPhoto.view_lat == null || selectedPhoto.view_lng == null
                              ? "ikke estimert"
                              : `${formatCoordinate(selectedPhoto.view_lat)}, ${formatCoordinate(selectedPhoto.view_lng)}`}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[11px] uppercase tracking-[0.08em] text-earth-700/90">QC-score</dt>
                          <dd className="font-medium text-earth-950">
                            {formatConfidence(selectedPhoto.confidence_score)}
                            {selectedPhoto.needs_manual_qc ? " (manual review)" : ""}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[11px] uppercase tracking-[0.08em] text-earth-700/90">GSD</dt>
                          <dd className="font-medium text-earth-950">{formatGsd(selectedPhoto.gsd_m)}</dd>
                        </div>
                        <div>
                          <dt className="text-[11px] uppercase tracking-[0.08em] text-earth-700/90">Bildeavtrykk</dt>
                          <dd className="font-medium text-earth-950">
                            {formatMeters(selectedPhoto.image_footprint_w_m)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[11px] uppercase tracking-[0.08em] text-earth-700/90">Track spacing</dt>
                          <dd className="font-medium text-earth-950">
                            {formatMeters(selectedPhoto.track_spacing_m)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[11px] uppercase tracking-[0.08em] text-earth-700/90">Overlap</dt>
                          <dd className="font-medium text-earth-950">
                            Front {formatPercent(selectedPhoto.overlap_front)} / Side {formatPercent(selectedPhoto.overlap_side)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[11px] uppercase tracking-[0.08em] text-earth-700/90">Oblique-korreksjon</dt>
                          <dd className="font-medium text-earth-950">
                            {selectedPhoto.oblique_correction_applied == null
                              ? "ukjent"
                              : selectedPhoto.oblique_correction_applied
                                ? "Ja"
                                : "Nei"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[11px] uppercase tracking-[0.08em] text-earth-700/90">Analyse-sone</dt>
                          <dd className="font-medium text-earth-950">
                            {selectedPhoto.analysis_zone?.sampling_strategy?.type ?? "ingen"}
                            {selectedPhoto.analysis_zone?.sampling_strategy?.radius_m == null
                              ? ""
                              : ` · ${selectedPhoto.analysis_zone.sampling_strategy.radius_m} m`}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[11px] uppercase tracking-[0.08em] text-earth-700/90">5-punkts målepunkter</dt>
                          <dd className="font-medium text-earth-950">
                            {selectedPhoto.analysis_zone?.sample_points?.length ?? 0}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[11px] uppercase tracking-[0.08em] text-earth-700/90">Usikkerhets-radius</dt>
                          <dd className="font-medium text-earth-950">
                            {formatMeters(selectedPhoto.location_uncertainty_m)}
                          </dd>
                        </div>
                        {selectedPhoto.confidence_reasons.length > 0 ? (
                          <div>
                            <dt className="text-[11px] uppercase tracking-[0.08em] text-earth-700/90">QC-grunner</dt>
                            <dd className="font-medium text-earth-950">
                              <span className="text-xs">{selectedPhoto.confidence_reasons.join(", ")}</span>
                            </dd>
                          </div>
                        ) : null}
                        <div>
                          <dt className="text-[11px] uppercase tracking-[0.08em] text-earth-700/90">Manuell QC</dt>
                          <dd className="mt-1">
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
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[11px] uppercase tracking-[0.08em] text-earth-700/90">Kartutsnitt</dt>
                          <dd className="mt-1">
                            <PhotoMapInset photo={selectedPhoto} baseMapStyle={baseMapStyle} />
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[11px] uppercase tracking-[0.08em] text-earth-700/90">Photo-ID</dt>
                          <dd className="break-all font-medium text-earth-950">{selectedPhoto.id}</dd>
                        </div>

                        <div>
                          <dt className="text-[11px] uppercase tracking-[0.08em] text-earth-700/90">Tags</dt>
                          <dd className="mt-1 space-y-2">
                            <div className="flex flex-wrap gap-1.5">
                              {metadataTagsDraft.length > 0 ? (
                                metadataTagsDraft.map((tag) => (
                                  <span
                                    key={tag}
                                    className="inline-flex items-center gap-1 rounded-full border border-earth-500/28 bg-white/76 px-2.5 py-1 text-xs text-earth-900"
                                  >
                                    {tag}
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
                                  </span>
                                ))
                              ) : (
                                <span className="text-xs text-earth-700/85">Ingen tags ennå</span>
                              )}
                            </div>
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
                          </dd>
                        </div>

                        <div className="mt-1 rounded-xl border border-earth-500/20 bg-white/75 p-2 text-earth-900">
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
                                (analysisBusyPhotoId === selectedPhoto.id) ||
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

                        <div>
                          <dt className="text-[11px] uppercase tracking-[0.08em] text-earth-700/90">Notat</dt>
                          <dd className="mt-1 space-y-2">
                            <textarea
                              className="min-h-[72px] w-full rounded-xl border border-earth-500/20 bg-white/75 p-2 text-sm text-earth-900 outline-none focus-visible:ring-2 focus-visible:ring-earth-700/30"
                              value={metadataCaptionDraft}
                              placeholder="Skriv notat ..."
                              onChange={(event) => setMetadataCaptionDraft(event.target.value)}
                              disabled={metadataBusyPhotoId === selectedPhoto.id}
                            />
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-8"
                              onClick={() => void handleSavePhotoMetadata()}
                              disabled={!hasMetadataChanges || metadataBusyPhotoId === selectedPhoto.id}
                            >
                              Lagre metadata
                            </Button>
                          </dd>
                        </div>
                      </dl>
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
