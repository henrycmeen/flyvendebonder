import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Menu, RefreshCw } from "lucide-react";

import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "@/lib/api";
import { subscribeClientLogs } from "@/lib/client-logger";
import {
  buildPhotoStatusText,
  formatPropertyReference,
  normalizeTagsInput,
  numbersEqual,
  parseDraftNumber,
  parseManualViewTarget,
  sameManualViewTarget,
  splitCapturedDate,
  toDraftNumber,
  toLogDetails,
  type ManualViewTarget,
} from "@/lib/formatters";
import { BASE_MAP_STYLES, type BaseMapStyle } from "@/lib/map-styles";
import { makePhotoFilter } from "@/lib/photo-filters";
import { buildNearestPath, compareByCapturedAtThenId, mergePhotoPages, photoIdKey } from "@/lib/photo-ordering";
import { DEV_ORTHOPHOTO_OVERLAYS } from "@/lib/orthophoto-overlays";
import { selectVisibleOrthophotoOverlays } from "@/lib/orthophoto-overlay-selection";
import { monthToSeason, type SeasonFilter as ThemeSeasonFilter } from "@/lib/season-theme";
import { useMapPreferences } from "@/hooks/use-map-preferences";
import { useOperatingAreaTool } from "@/hooks/use-operating-area-tool";
import { AlbumPage } from "@/components/album-page";
import { OrthophotoPage } from "@/components/orthophoto-page";
import { AppSidebar } from "@/components/app-sidebar";
import { FilterPanel } from "@/components/filter-panel";
import { MapLayerPanel } from "@/components/map-layer-panel";
import { MediaImportPage, type MediaImportSelection } from "@/components/media-import-page";
import { MapCanvas } from "@/components/map-canvas";
import { OperatingAreaInspector } from "@/components/operating-area-inspector";
import { PlanningPage } from "@/components/planning-page";
import { PhotoInspector } from "@/components/photo-inspector";
import { SkogbrukPage } from "@/components/skogbruk-page";
import { VideoPage } from "@/components/video-page";
import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import type {
  AdminSessionStatus,
  FlightMission,
  FlightMissionListResponse,
  GardskartJob,
  MediaFinalizeResult,
  MediaStagingEnvelope,
  MediaFinalizeEnvelope,
  VideoMapArtifact,
  PhotoAnalysis,
  PhotoAnalysisActionResponse,
  PhotoMetadataActionResponse,
  PhotoFeature,
  PhotosPageResponse,
  PhotosResponse,
  Property,
  ProfileResponse,
  TimelineDate,
  TimelineResponse,
  VideoMapReviewPayload,
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

type SeasonFilter = ThemeSeasonFilter;
type DayScope = "all" | "selected";
type AppView = "map" | "planning" | "album" | "orthophotos" | "forest" | "import" | "video";
type UiTheme = "standard" | "satellite";
const CONFIDENCE_FILTER_THRESHOLD = 0.72;
const MAP_PHOTO_PAGE_LIMIT = 180;
const MAP_PHOTO_TIMEOUT_MS = 45_000;
const MAP_PHOTO_MAX_PAGES = 80;
const VIDEO_JOB_QUEUE_STORAGE_KEY = "fb-video-job-queue";
const VIDEO_JOB_ARCHIVE_STORAGE_KEY = "fb-video-job-archive";
const VIDEO_JOB_ARTIFACTS_STORAGE_KEY = "fb-video-job-artifacts";
const BROWSER_MEDIA_IMPORT_ENABLED = true;
const BROWSER_MEDIA_IMPORT_DISABLED_REASON =
  "Bildeimport er midlertidig utilgjengelig.";
const VIDEO_WORKFLOW_ENABLED = false;
const VIDEO_WORKFLOW_DISABLED_REASON =
  "Videoflyten er midlertidig slått av. Video og ortofoto trenger egen prosesseringsløype før de kan importeres her.";
function resolveInitialView(rawView: string | null): AppView {
  if (rawView === "planning") return "planning";
  if (rawView === "album") return "album";
  if (rawView === "forest" || rawView === "skogbruk") return "forest";
  if (rawView === "import") {
    return BROWSER_MEDIA_IMPORT_ENABLED ? "import" : "map";
  }
  if (rawView === "video") {
    return VIDEO_WORKFLOW_ENABLED ? "video" : "map";
  }
  return "map";
}

function getInitialViewBlockReason(rawView: string | null): string | null {
  if (rawView === "import" && !BROWSER_MEDIA_IMPORT_ENABLED) {
    return BROWSER_MEDIA_IMPORT_DISABLED_REASON;
  }
  if (rawView === "video" && !VIDEO_WORKFLOW_ENABLED) {
    return VIDEO_WORKFLOW_DISABLED_REASON;
  }
  return null;
}

function mergeUniqueJobIds(current: string[], incoming: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  [...current, ...incoming].forEach((jobId) => {
    const value = String(jobId).trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    merged.push(value);
  });
  return merged;
}

function parseStoredVideoArtifacts(raw: string | null): VideoMapArtifact[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
      const artifact = entry as Partial<VideoMapArtifact>;
      const jobId = typeof artifact.jobId === "string" ? artifact.jobId.trim() : "";
      const createdAt = typeof artifact.createdAt === "string" ? artifact.createdAt : "";
      const mode = typeof artifact.mode === "string" ? artifact.mode : "frames";
      const reviewState = artifact.reviewState;
      if (!jobId || !createdAt) return [];
      if (reviewState !== "placed" && reviewState !== "kept" && reviewState !== "discarded") return [];

      return [
        {
          jobId,
          createdAt,
          mode,
          reviewState,
          placement: artifact.placement ?? null,
          map3dResult: artifact.map3dResult ?? null,
        } satisfies VideoMapArtifact,
      ];
    });
  } catch {
    return [];
  }
}

const isRequestAborted = (error: ApiError): boolean =>
  error.status === 0 && error.message === "Request avbrutt";

interface TimelineEntryIndexed extends TimelineDate {
  index: number;
  year: string;
  month: string;
  season: Exclude<SeasonFilter, "all">;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

async function readResponsePayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function responseErrorText(payload: unknown, response: Response): string {
  if (typeof payload === "string" && payload.trim().length > 0) {
    return payload;
  }

  if (payload && typeof payload === "object") {
    const detail = (payload as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail.trim().length > 0) {
      return detail;
    }
    const message = (payload as { message?: unknown }).message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message;
    }
  }

  return `Request feilet med status ${response.status}`;
}

function formatCount(value: number, singular: string, plural: string): string | null {
  if (value <= 0) return null;
  return `${value} ${value === 1 ? singular : plural}`;
}

function isForestOverlay(overlay: (typeof DEV_ORTHOPHOTO_OVERLAYS)[number]): boolean {
  const text = `${overlay.id} ${overlay.label}`.toLocaleLowerCase("nb-NO");
  return text.includes("skog");
}

function summarizeMediaFinalizeResult(result: MediaFinalizeResult): string {
  const failedCount = result.items.filter((item) => item.status === "failed" || item.status === "rejected").length;
  const parts = [
    formatCount(result.image_imported_count, "bilde importert", "bilder importert"),
    formatCount(result.image_skipped_count, "duplikat hoppet over", "duplikater hoppet over"),
    formatCount(failedCount, "fil feilet", "filer feilet"),
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(" · ") : "Ingen nye bilder ble importert.";
}

function filenameFromDisposition(headerValue: string | null, fallback: string): string {
  if (!headerValue) return fallback;
  const starMatch = headerValue.match(/filename\*=UTF-8''([^;]+)/i);
  if (starMatch?.[1]) {
    try {
      return decodeURIComponent(starMatch[1]);
    } catch {
      return starMatch[1];
    }
  }
  const match = headerValue.match(/filename="?([^";]+)"?/i);
  return match?.[1] ? match[1] : fallback;
}

function describeMissionExportFormat(exportFormat: string | null): string {
  if (exportFormat === "dji.fly.kmz.v1") {
    return "DJI Fly KMZ for Mini 4 Pro";
  }
  if (exportFormat === "dji.wpml.kmz.v1") {
    return "DJI KMZ for enterprise-profiler";
  }
  return "generell bundle";
}

function hasActiveAdminSession(session: AdminSessionStatus | null): boolean {
  if (!session?.authenticated) {
    return false;
  }
  if (!session.expires_at) {
    return false;
  }
  const expiresAt = Date.parse(session.expires_at);
  if (Number.isNaN(expiresAt)) {
    return false;
  }
  return expiresAt > Date.now();
}

function sortFlightMissions(items: FlightMission[]): FlightMission[] {
  return [...items].sort((left, right) => {
    const updatedDiff = Date.parse(right.updated_at) - Date.parse(left.updated_at);
    if (updatedDiff !== 0) return updatedDiff;
    return right.id - left.id;
  });
}

function getPhotoImageUrl(photo: Pick<PhotoFeature, "image_url" | "thumbnail_url"> | null | undefined): string | null {
  return photo?.image_url?.trim() || photo?.thumbnail_url?.trim() || null;
}

export default function App() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const initialDate = params.get("date");
  const initialPhoto = params.get("photo");
  const rawInitialView = params.get("view");
  const initialView = resolveInitialView(rawInitialView);
  const hasExplicitDeepLink = initialDate !== null || initialPhoto !== null;
  const blockedInitialViewReasonRef = useRef<string | null>(getInitialViewBlockReason(rawInitialView));

  const [activeView, setActiveView] = useState<AppView>(initialView);
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [adminSession, setAdminSession] = useState<AdminSessionStatus | null>(null);
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
  const {
    baseMapStyle,
    mapGrayscale,
    mapVintage,
    showZoomControls,
    setBaseMapStyle,
    setMapGrayscale,
    setMapVintage,
    setShowZoomControls,
  } = useMapPreferences();
  const [propertyJobs, setPropertyJobs] = useState<GardskartJob[]>([]);
  const [flightMissions, setFlightMissions] = useState<FlightMission[]>([]);
  const [, setFlightMissionStatus] = useState("Flyoppdrag lastes ...");
  const [activeFlightMissionId, setActiveFlightMissionId] = useState<number | null>(null);
  const [flightMissionFocusToken, setFlightMissionFocusToken] = useState(0);
  const [flightMissionExportBusyId, setFlightMissionExportBusyId] = useState<number | null>(null);
  const [flightMissionDeleteBusyId, setFlightMissionDeleteBusyId] = useState<number | null>(null);
  const [videoMapArtifacts, setVideoMapArtifacts] = useState<VideoMapArtifact[]>(() => {
    if (typeof window === "undefined") return [];
    return parseStoredVideoArtifacts(window.localStorage.getItem(VIDEO_JOB_ARTIFACTS_STORAGE_KEY));
  });
  const [showPropertyLayer, setShowPropertyLayer] = useState(true);
  const [showSoilLayer, setShowSoilLayer] = useState(false);
  const [showForestLayer, setShowForestLayer] = useState(false);
  const [showOnlyManualQc, setShowOnlyManualQc] = useState(false);
  const [showOnlyLowConfidence, setShowOnlyLowConfidence] = useState(false);
  const [propertyStatus, setPropertyStatus] = useState("Laster eiendomslag ...");
  const [soilStatus, setSoilStatus] = useState("Jordsmonnlag er skrudd av.");
  const [statusText, setStatusText] = useState("Laster data ...");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [backendLogs, setBackendLogs] = useState<BackendLogEntry[]>([]);
  const [isBackendLogsLoading, setIsBackendLogsLoading] = useState(false);
  const [isAdminSessionBusy, setIsAdminSessionBusy] = useState(false);
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
  const [mediaImportError, setMediaImportError] = useState("");
  const [mediaImportSummary, setMediaImportSummary] = useState("");
  const [isMediaImportSubmitting, setIsMediaImportSubmitting] = useState(false);
  const [initialVideoJobIds] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(VIDEO_JOB_QUEUE_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.map((item) => String(item)).filter((item) => item.length > 0) : [];
    } catch {
      return [];
    }
  });
  const [archivedVideoJobIds, setArchivedVideoJobIds] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(VIDEO_JOB_ARCHIVE_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.map((item) => String(item)).filter((item) => item.length > 0) : [];
    } catch {
      return [];
    }
  });
  const [photosLoadFailed, setPhotosLoadFailed] = useState(false);
  const [isMapPhotosLoading, setIsMapPhotosLoading] = useState(false);
  const [photoLoadRetryToken, setPhotoLoadRetryToken] = useState(0);
  const [albumLoadFailed, setAlbumLoadFailed] = useState(false);
  const [albumScrollSpin, setAlbumScrollSpin] = useState(false);
  const [mapFocusToken, setMapFocusToken] = useState(0);
  const [focusedOrthophotoId, setFocusedOrthophotoId] = useState<string | null>(null);
  const [orthophotoFocusToken, setOrthophotoFocusToken] = useState(0);
  const [colorAnalysisActive, setColorAnalysisActive] = useState(false);
  const [operatingAreaCenterInspectToken, setOperatingAreaCenterInspectToken] = useState(0);
  const [soilRefreshToken, setSoilRefreshToken] = useState(0);
  const [isFilterExpanded, setIsFilterExpanded] = useState(false);
  const activeUiSeason = useMemo<Exclude<SeasonFilter, "all">>(() => {
    if (selectedSeason !== "all") return selectedSeason;
    const month = new Date().getMonth() + 1;
    return monthToSeason(String(month));
  }, [selectedSeason]);

  useEffect(() => {
    document.documentElement.dataset.season = activeUiSeason;
    return () => {
      document.documentElement.removeAttribute("data-season");
    };
  }, [activeUiSeason]);
  useEffect(() => {
    try {
      if (initialVideoJobIds.length === 0) {
        window.localStorage.removeItem(VIDEO_JOB_QUEUE_STORAGE_KEY);
        return;
      }
      window.localStorage.setItem(VIDEO_JOB_QUEUE_STORAGE_KEY, JSON.stringify(initialVideoJobIds));
    } catch {
      // Ignore storage errors in private mode or unsupported browsers.
    }
  }, [initialVideoJobIds]);
  useEffect(() => {
    try {
      if (archivedVideoJobIds.length === 0) {
        window.localStorage.removeItem(VIDEO_JOB_ARCHIVE_STORAGE_KEY);
        return;
      }
      window.localStorage.setItem(VIDEO_JOB_ARCHIVE_STORAGE_KEY, JSON.stringify(archivedVideoJobIds));
    } catch {
      // Ignore storage errors in private mode or unsupported browsers.
    }
  }, [archivedVideoJobIds]);
  useEffect(() => {
    try {
      if (videoMapArtifacts.length === 0) {
        window.localStorage.removeItem(VIDEO_JOB_ARTIFACTS_STORAGE_KEY);
        return;
      }
      window.localStorage.setItem(VIDEO_JOB_ARTIFACTS_STORAGE_KEY, JSON.stringify(videoMapArtifacts));
    } catch {
      // Ignore storage errors in private mode or unsupported browsers.
    }
  }, [videoMapArtifacts]);
  const [mapResetToken, setMapResetToken] = useState(0);
  const [syncSelectionToUrl, setSyncSelectionToUrl] = useState(() => Boolean(initialDate || initialPhoto));
  const uiTheme: UiTheme = baseMapStyle === "satellite" ? "satellite" : "standard";

  const initialPhotoRef = useRef<string | null>(initialPhoto);
  const tileRetryJobRef = useRef<string | null>(null);
  const soilRetryCountRef = useRef(0);
  const baseMapTileErrorRef = useRef<BaseMapStyle | null>(null);
  const albumScrollSpinTimeoutRef = useRef<number | null>(null);
  const bootstrapAbortRef = useRef<AbortController | null>(null);
  const profileAbortRef = useRef<AbortController | null>(null);
  const adminSessionAbortRef = useRef<AbortController | null>(null);
  const timelineAbortRef = useRef<AbortController | null>(null);
  const photosAbortRef = useRef<AbortController | null>(null);
  const backendLogAbortRef = useRef<AbortController | null>(null);
  const gardskartJobAbortRef = useRef<AbortController | null>(null);
  const albumAbortRef = useRef<AbortController | null>(null);
  const photoLoadSeqRef = useRef(0);
  const albumLoadSeqRef = useRef(0);
  const profileLoadSeqRef = useRef(0);
  const adminSessionLoadSeqRef = useRef(0);
  const timelineLoadSeqRef = useRef(0);
  const backendLogLoadSeqRef = useRef(0);
  const gardskartJobLoadSeqRef = useRef(0);
  const bootstrapLoadSeqRef = useRef(0);
  const autoAppliedLatestFiltersRef = useRef(false);

  const selectedDate = timeline[selectedIndex]?.date ?? null;
  const activeProperties = useMemo<Property[]>(() => {
    if (!profile) return [];
    return [profile.property, ...(profile.additional_properties ?? [])].filter(
      (property): property is Property => property !== null,
    );
  }, [profile]);
  const currentProperty = profile?.property ?? null;
  const isLoading = pendingRequests > 0;
  const isAdminAuthenticated = hasActiveAdminSession(adminSession);
  const photos = useMemo(() => {
    if (dayScope === "selected") {
      if (!selectedDate) return [];
      return photoPool.filter((photo) => photo.captured_date === selectedDate);
    }

    return photoPool;
  }, [dayScope, photoPool, selectedDate]);
  const mapPhotoFilter = useMemo(
    () =>
      makePhotoFilter({
        selectedYear,
        selectedSeason,
        showOnlyManualQc,
        showOnlyLowConfidence,
        lowConfidenceThreshold: CONFIDENCE_FILTER_THRESHOLD,
      }),
    [selectedSeason, selectedYear, showOnlyLowConfidence, showOnlyManualQc],
  );
  const selectedPhoto = useMemo(() => {
    if (!selectedPhotoId) return null;
    return (
      photos.find((photo) => photoIdKey(photo.id) === photoIdKey(selectedPhotoId)) ??
      albumPhotos.find((photo) => photoIdKey(photo.id) === photoIdKey(selectedPhotoId)) ??
      null
    );
  }, [albumPhotos, photos, selectedPhotoId]);
  const selectedPhotoImageUrl = useMemo(() => getPhotoImageUrl(selectedPhoto), [selectedPhoto]);
  const selectedPhotoExistsInMap = useMemo(() => {
    if (!selectedPhotoId) return false;
    return photos.some((photo) => photoIdKey(photo.id) === photoIdKey(selectedPhotoId));
  }, [photos, selectedPhotoId]);
  const selectedPhotoManualViewTarget = useMemo(
    () => parseManualViewTarget(selectedPhoto?.tags),
    [selectedPhoto?.tags],
  );
  const hoverPreviewPhoto = useMemo(() => {
    if (!hoverPreviewPhotoId) return null;
    return photos.find((photo) => photoIdKey(photo.id) === photoIdKey(hoverPreviewPhotoId)) ?? null;
  }, [hoverPreviewPhotoId, photos]);
  const hoverPreviewImageUrl = useMemo(() => getPhotoImageUrl(hoverPreviewPhoto), [hoverPreviewPhoto]);
  const resolvedMapAnchorId = useMemo(() => {
    if (!selectedPhotoId) return null;
    if (mapNavigationAnchorId && photos.some((photo) => photoIdKey(photo.id) === photoIdKey(mapNavigationAnchorId))) {
      return mapNavigationAnchorId;
    }
    return photoIdKey(selectedPhotoId);
  }, [mapNavigationAnchorId, photos, selectedPhotoId]);
  const navigationPhotos = useMemo(() => {
    if (activeView === "album") {
      return [...albumPhotos].sort((a, b) => compareByCapturedAtThenId(b, a));
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

  const orthophotoDates = useMemo(() => {
    const propertyReferences = new Set(activeProperties.map((property) => formatPropertyReference(property)));
    return DEV_ORTHOPHOTO_OVERLAYS.filter((overlay) => propertyReferences.has(overlay.propertyReference)).map(
      (overlay) => overlay.capturedDate,
    );
  }, [activeProperties]);

  const activeOrthophotoOverlays = useMemo(() => {
    const propertyReferences = new Set(activeProperties.map((property) => formatPropertyReference(property)));
    return DEV_ORTHOPHOTO_OVERLAYS.filter((overlay) => propertyReferences.has(overlay.propertyReference));
  }, [activeProperties]);

  const visibleMapOrthophotoOverlays = useMemo(() => {
    const propertyReferences = new Set(activeProperties.map((property) => formatPropertyReference(property)));
    return selectVisibleOrthophotoOverlays({
      overlays: DEV_ORTHOPHOTO_OVERLAYS,
      propertyReferences,
      selectedYear,
      selectedSeason,
    });
  }, [activeProperties, selectedSeason, selectedYear]);

  const activeForestOverlays = useMemo(
    () => activeOrthophotoOverlays.filter(isForestOverlay),
    [activeOrthophotoOverlays],
  );

  useEffect(() => {
    if (visibleMapOrthophotoOverlays.length > 0 || !colorAnalysisActive) return;
    setColorAnalysisActive(false);
  }, [colorAnalysisActive, visibleMapOrthophotoOverlays.length]);

  const colorAnalysisStatus =
    visibleMapOrthophotoOverlays.length > 0
      ? colorAnalysisActive
        ? "Fargeanalyse aktiv. Klikk i synlig ortofoto."
        : `${visibleMapOrthophotoOverlays.length} ortofoto kan analyseres i valgt filter.`
      : "Ingen synlige ortofoto i valgt år/sesong.";

  const forestStatus =
    activeForestOverlays.length > 0
      ? showForestLayer
        ? `${activeForestOverlays.length} skogflater vises som indikativt kartlag.`
        : `${activeForestOverlays.length} skogflater tilgjengelig.`
      : "Ingen skogflater tilgjengelig for aktiv eiendom.";

  const availableYears = useMemo(
    () =>
      Array.from(
        new Set([
          ...timelineIndexed.map((entry) => entry.year),
          ...orthophotoDates.map((date) => date.slice(0, 4)),
        ]),
      ).sort((a, b) => Number(b) - Number(a)),
    [orthophotoDates, timelineIndexed],
  );

  const latestAvailableCapturedDate = useMemo(() => {
    const candidates = [...timelineIndexed.map((entry) => entry.date), ...orthophotoDates].filter(Boolean);
    if (candidates.length === 0) return null;
    return [...candidates].sort().at(-1) ?? null;
  }, [orthophotoDates, timelineIndexed]);

  const seasonCounts = useMemo(() => {
    const source = selectedYear === "all" ? timelineIndexed : timelineIndexed.filter((entry) => entry.year === selectedYear);
    const orthophotoSource =
      selectedYear === "all"
        ? orthophotoDates
        : orthophotoDates.filter((date) => date.startsWith(`${selectedYear}-`));
    return {
      spring:
        source.filter((entry) => entry.season === "spring").length +
        orthophotoSource.filter((date) => monthToSeason(date.slice(5, 7)) === "spring").length,
      summer:
        source.filter((entry) => entry.season === "summer").length +
        orthophotoSource.filter((date) => monthToSeason(date.slice(5, 7)) === "summer").length,
      autumn:
        source.filter((entry) => entry.season === "autumn").length +
        orthophotoSource.filter((date) => monthToSeason(date.slice(5, 7)) === "autumn").length,
      winter:
        source.filter((entry) => entry.season === "winter").length +
        orthophotoSource.filter((date) => monthToSeason(date.slice(5, 7)) === "winter").length,
    };
  }, [orthophotoDates, selectedYear, timelineIndexed]);

  const resolveSeasonForYearChange = useCallback(
    (nextYear: string): SeasonFilter => {
      if (selectedSeason === "all") return "all";
      const source = nextYear === "all" ? timelineIndexed : timelineIndexed.filter((entry) => entry.year === nextYear);
      const orthophotoSource =
        nextYear === "all"
          ? orthophotoDates
          : orthophotoDates.filter((date) => date.startsWith(`${nextYear}-`));
      return source.some((entry) => entry.season === selectedSeason) ||
        orthophotoSource.some((date) => monthToSeason(date.slice(5, 7)) === selectedSeason)
        ? selectedSeason
        : "all";
    },
    [orthophotoDates, selectedSeason, timelineIndexed],
  );

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
  const activeVideoMapArtifacts = useMemo(
    () => videoMapArtifacts.filter((artifact) => artifact.reviewState === "placed"),
    [videoMapArtifacts],
  );

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
    const blockedReason = blockedInitialViewReasonRef.current;
    if (!blockedReason) return;

    setStatusText(blockedReason);
    addLog("warn", "Deaktivert view i URL ble ignorert", null, {
      requestedView: rawInitialView,
    });
    blockedInitialViewReasonRef.current = null;
  }, [addLog, rawInitialView]);

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
        cache: false,
        dedupe: false,
      });

      if (seq !== profileLoadSeqRef.current) return data;

      setProfile(data);
      addLog("info", "Profil lastet", requestId, { userId: data.user.id });
      return data;
    });
  }, [addLog, trackRequest]);

  const clearPrivateProfileState = useCallback(() => {
    profileLoadSeqRef.current += 1;
    profileAbortRef.current?.abort();
    profileAbortRef.current = null;
    setProfile(null);
    setBackendLogs([]);
    setMetadataEditMode(false);
  }, []);

  const logoutAdminAndLoadPublicProfile = useCallback(async () => {
    clearPrivateProfileState();
    const response = await apiPost<AdminSessionStatus>("/api/v1/admin/logout");
    setAdminSession(response.data);
    await loadProfile();
    return response;
  }, [clearPrivateProfileState, loadProfile]);

  const handleOperatingAreaConfirmed = useCallback(
    async () => {
      await loadProfile();
      addLog("info", "Jorde lagt til fra kartverktøy");
    },
    [addLog, loadProfile],
  );
  const operatingAreaTool = useOperatingAreaTool({ onConfirmed: handleOperatingAreaConfirmed });
  const deactivateOperatingAreaTool = operatingAreaTool.deactivate;

  useEffect(() => {
    if (activeView !== "map") deactivateOperatingAreaTool();
  }, [activeView, deactivateOperatingAreaTool]);

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

  const loadFlightMissions = useCallback(
    async (options?: { signal?: AbortSignal; silent?: boolean }) => {
      if (activeProperties.length === 0) {
        setFlightMissions([]);
        setFlightMissionStatus("Ingen aktive eiendommer valgt for flyoppdrag.");
        return null;
      }

      try {
        const responses = await trackRequest(() =>
          Promise.all(
            activeProperties.map((property) =>
              apiGet<FlightMissionListResponse>(`/api/v1/flight-missions?property_id=${property.id}`, {
                signal: options?.signal,
                cache: false,
                dedupe: false,
              }),
            ),
          ),
        );

        const nextMissions = sortFlightMissions(
          responses.flatMap((response) => (Array.isArray(response.data?.missions) ? response.data.missions : [])),
        );
        setFlightMissions(nextMissions);
        setFlightMissionStatus(
          nextMissions.length === 0
            ? "Ingen lagrede flyoppdrag ennå. Velg jorder og lag første oppdrag."
            : `${nextMissions.length} flyoppdrag klare for eksport eller videre justering.`,
        );
        if (!options?.silent) {
          addLog("info", "Flyoppdrag lastet", responses[0]?.requestId ?? null, {
            propertyCount: activeProperties.length,
            count: nextMissions.length,
          });
        }
        return nextMissions;
      } catch (error) {
        const apiError = error as ApiError;
        if (isRequestAborted(apiError)) return null;
        setFlightMissions([]);
        setFlightMissionStatus(`Kunne ikke laste flyoppdrag: ${apiError.message}`);
        addLog("error", "Kunne ikke laste flyoppdrag", apiError.requestId, apiError.detail);
        return null;
      }
    },
    [activeProperties, addLog, trackRequest],
  );

  const loadAdminSession = useCallback(async (options?: { signal?: AbortSignal; silent?: boolean }): Promise<AdminSessionStatus | null> => {
    const seq = ++adminSessionLoadSeqRef.current;
    let confirmedSession: AdminSessionStatus | null = null;
    const requestController = options?.signal
      ? null
      : (() => {
          adminSessionAbortRef.current?.abort();
          const next = new AbortController();
          adminSessionAbortRef.current = next;
          return next;
        })();

    try {
      const { data, requestId } = await trackRequest(() =>
        apiGet<AdminSessionStatus>("/api/v1/admin/session", {
          signal: requestController?.signal ?? options?.signal,
          cache: false,
          dedupe: false,
        }),
      );
      confirmedSession = data;

      if (seq !== adminSessionLoadSeqRef.current) return data;

      if (!data.authenticated) {
        setAdminSession(data);
        clearPrivateProfileState();
        await loadProfile({ signal: requestController?.signal ?? options?.signal });
      } else {
        await loadProfile({ signal: requestController?.signal ?? options?.signal });
        if (seq !== adminSessionLoadSeqRef.current) return data;
        setAdminSession(data);
      }
      if (!options?.silent && data.authenticated) {
        addLog("info", "Admin-sesjon bekreftet", requestId, {
          expiresAt: data.expires_at,
        });
      }
      return data;
    } catch (error) {
      const apiError = error as ApiError;
      if (seq !== adminSessionLoadSeqRef.current) return null;
      if (isRequestAborted(apiError)) return null;

      clearPrivateProfileState();
      if (confirmedSession) {
        const lockedSession: AdminSessionStatus = {
          configured: confirmedSession.configured,
          authenticated: false,
          expires_at: null,
        };
        setAdminSession(lockedSession);
        if (confirmedSession.authenticated) {
          try {
            await logoutAdminAndLoadPublicProfile();
          } catch (logoutError) {
            const logoutApiError = logoutError as ApiError;
            addLog("warn", "Kunne ikke rydde admin-sesjon etter profilfeil", logoutApiError.requestId, logoutApiError.detail);
          }
        }
        addLog("warn", "Admin-status bekreftet, men profilen kunne ikke lastes", apiError.requestId, apiError.detail);
        return lockedSession;
      }

      setAdminSession({
        configured: false,
        authenticated: false,
        expires_at: null,
      });
      addLog("warn", "Kunne ikke hente admin-status", apiError.requestId, apiError.detail);
      return null;
    }
  }, [addLog, clearPrivateProfileState, loadProfile, logoutAdminAndLoadPublicProfile, trackRequest]);

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
      if (apiError.status === 401) {
        setBackendLogs([]);
      }
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

  const ensureAdminAccess = useCallback((actionLabel: string): boolean => {
    if (hasActiveAdminSession(adminSession)) {
      return true;
    }

    const sessionExpired =
      adminSession?.authenticated &&
      Boolean(adminSession.expires_at) &&
      !hasActiveAdminSession(adminSession);

    if (sessionExpired) {
      setAdminSession((current) =>
        current
          ? {
              ...current,
              authenticated: false,
            }
          : current,
      );
      void logoutAdminAndLoadPublicProfile().catch((error) => {
        const apiError = error as ApiError;
        addLog("warn", "Kunne ikke fullføre utløpt admin-logout", apiError.requestId, apiError.detail);
      });
    }

    const message =
      adminSession === null
        ? "Sjekker admin-status ... prøv igjen om et øyeblikk."
        : sessionExpired
          ? "Admin-sesjonen er utløpt. Åpne Innstillinger → Admin og logg inn på nytt."
        : !adminSession.configured
          ? "Admin-kode er ikke konfigurert i backend ennå."
          : `Admin-tilgang kreves for ${actionLabel}. Åpne Innstillinger → Admin.`;

    setStatusText(message);
    addLog("warn", `${actionLabel} blokkert uten admin`, null, {
      configured: adminSession?.configured ?? null,
      authenticated: adminSession?.authenticated ?? null,
    });
    return false;
  }, [addLog, adminSession, logoutAdminAndLoadPublicProfile]);

  const loadGardskartJobs = useCallback(
    async (
      forceRefresh: boolean,
      options?: {
        signal?: AbortSignal;
        properties?: Property[];
      },
    ) => {
      const targetProperties = options?.properties ?? activeProperties;
      if (targetProperties.length === 0 || !showPropertyLayer) {
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
        const results = await Promise.all(
          targetProperties.map(async (property) => {
            try {
              const { data, requestId } = await trackRequest(() =>
                apiGet<GardskartJob>(`/api/v1/properties/${property.id}/gardskart-job`, {
                  query: { force_refresh: forceRefresh ? true : undefined },
                  signal: requestController?.signal ?? options?.signal,
                }),
              );
              return { ok: true as const, property, data, requestId };
            } catch (error) {
              return { ok: false as const, property, error: error as ApiError };
            }
          }),
        );

        if (seq !== gardskartJobLoadSeqRef.current) return;

        const successes = results.filter((result) => result.ok);
        const activeSuccesses = successes.filter((result) => result.data.source !== "disabled" && result.data.job_id);
        const disabledSuccesses = successes.filter((result) => result.data.source === "disabled" || !result.data.job_id);
        const failures = results.filter((result) => !result.ok);
        if (failures.length > 0 && failures.every((result) => isRequestAborted(result.error))) {
          return;
        }

        setPropertyJobs(activeSuccesses.map((result) => result.data));
        tileRetryJobRef.current = null;

        failures.forEach((result) => {
          if (isRequestAborted(result.error)) return;
          addLog("error", "jobId-henting feilet for eiendom", result.error.requestId, {
            detail: result.error.detail,
            property: formatPropertyReference(result.property),
          });
        });

        if (activeSuccesses.length === 0) {
          if (disabledSuccesses.length > 0) {
            setPropertyStatus("Eiendomslag er deaktivert i dette miljøet.");
            addLog("info", "Eiendomslag er deaktivert", null, {
              total: disabledSuccesses.length,
            });
            return;
          }

          setPropertyStatus("Kunne ikke hente eiendomslag fra backend.");
          return;
        }

        const hasStaleCache = activeSuccesses.some((result) => result.data.source === "stale-cache");
        const warningResults = activeSuccesses.filter((result) => {
          const statusDescLower = (result.data.status_desc ?? "").toLowerCase();
          return !(
            result.data.status_code === null ||
            result.data.status_code === 0 ||
            result.data.status_code === 1 ||
            statusDescLower.includes("response ok")
          );
        });

        if (failures.some((result) => !isRequestAborted(result.error))) {
          setPropertyStatus(`Eiendomslag delvis aktivt (${activeSuccesses.length} av ${targetProperties.length} eiendommer).`);
          addLog("warn", "Eiendomslag delvis lastet", null, {
            loaded: activeSuccesses.length,
            total: targetProperties.length,
          });
        } else if (hasStaleCache) {
          setPropertyStatus("Eiendomslag bruker cache pga feil mot NIBIO. Se teknisk logg.");
        } else if (warningResults.length > 0) {
          if (warningResults.some((result) => result.data.status_code === 100)) {
            setPropertyStatus("NIBIO kunne ikke hente alle eiendomsgrenser nå (kode 100 på minst én eiendom).");
          } else {
            setPropertyStatus("Eiendomslag aktivt, men NIBIO meldte avvik. Se teknisk logg.");
          }
          warningResults.forEach((result) => {
            addLog("warn", "NIBIO returnerte avvik for eiendomslag", result.requestId, {
              property: formatPropertyReference(result.property),
              statusCode: result.data.status_code,
              statusDesc: result.data.status_desc,
              source: result.data.source,
            });
          });
        } else if (activeSuccesses.length === 1) {
          setPropertyStatus(`Eiendomslag aktivt (${formatPropertyReference(activeSuccesses[0].property)}).`);
        } else {
          setPropertyStatus(`Eiendomslag aktivt (${activeSuccesses.length} eiendommer).`);
        }

        addLog("info", forceRefresh ? "Eiendomslag oppfrisket" : "Eiendomslag lastet", null, {
          properties: activeSuccesses.map((result) => formatPropertyReference(result.property)),
          total: activeSuccesses.length,
        });
      } catch (error) {
        const apiError = error as ApiError;
        if (seq !== gardskartJobLoadSeqRef.current) return;
        if (isRequestAborted(apiError)) return;
        setPropertyStatus("Kunne ikke hente eiendomslag fra backend.");
        addLog("error", "jobId-henting feilet", apiError.requestId, apiError.detail);
        setPropertyJobs([]);
      }
    },
    [activeProperties, addLog, showPropertyLayer, trackRequest],
  );

  const handlePhotoAnalysisAction = useCallback(
    async (photoId: string, action: "approve" | "recompute") => {
      if (analysisBusyPhotoId === photoId) return;
      if (!ensureAdminAccess(action === "approve" ? "godkjenning av posisjon" : "analyseberegning")) return;

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
    [addLog, analysisBusyPhotoId, ensureAdminAccess, trackRequest, updatePhotoAnalysisState],
  );

  const handleSavePhotoMetadata = useCallback(async () => {
    if (!selectedPhoto) return;
    if (metadataBusyPhotoId === selectedPhoto.id) return;
    if (!ensureAdminAccess("metadataendring")) return;

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
    ensureAdminAccess,
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
    if (activeView === "album") {
      setSelectedPhotoId(null);
    }
  }, [activeView]);

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
          const timelineData = await loadTimeline({ signal });

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
          setStatusText("Klar.");
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
  }, [addLog, initialDate, loadTimeline]);

  useEffect(() => {
    const abortController = new AbortController();
    void loadAdminSession({ signal: abortController.signal, silent: true });
    return () => {
      abortController.abort();
    };
  }, [loadAdminSession]);

  useEffect(() => {
    if (!adminSession?.authenticated) return;

    if (!adminSession.expires_at) {
      setAdminSession((current) =>
        current
          ? {
              ...current,
              authenticated: false,
            }
          : current,
      );
      void logoutAdminAndLoadPublicProfile().catch((error) => {
        const apiError = error as ApiError;
        addLog("warn", "Kunne ikke låse ugyldig admin-sesjon på serveren", apiError.requestId, apiError.detail);
      });
      return;
    }

    const expiresAt = Date.parse(adminSession.expires_at);
    if (Number.isNaN(expiresAt)) {
      setAdminSession((current) =>
        current
          ? {
              ...current,
              authenticated: false,
              expires_at: null,
            }
          : current,
      );
      void logoutAdminAndLoadPublicProfile().catch((error) => {
        const apiError = error as ApiError;
        addLog("warn", "Kunne ikke fullføre automatisk admin-logout", apiError.requestId, apiError.detail);
      });
      return;
    }

    const expiryDelayMs = Math.max(0, expiresAt - Date.now() + 250);
    const timeoutId = window.setTimeout(() => {
      setAdminSession((current) =>
        current
          ? {
              ...current,
              authenticated: false,
              expires_at: null,
            }
          : current,
      );
      void logoutAdminAndLoadPublicProfile().catch((error) => {
        const apiError = error as ApiError;
        addLog("warn", "Kunne ikke fullføre automatisk admin-logout", apiError.requestId, apiError.detail);
      });
    }, expiryDelayMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [addLog, adminSession?.authenticated, adminSession?.expires_at, logoutAdminAndLoadPublicProfile]);

  useEffect(() => {
    const abortController = new AbortController();
    void loadFlightMissions({ signal: abortController.signal, silent: true });
    return () => {
      abortController.abort();
    };
  }, [activeProperties, loadFlightMissions]);

  useEffect(() => {
    setActiveFlightMissionId(null);
  }, [currentProperty?.id]);

  useEffect(() => {
    setActiveFlightMissionId((current) => {
      if (flightMissions.length === 0) return null;
      if (current != null && flightMissions.some((item) => item.id === current)) {
        return current;
      }
      return null;
    });
  }, [flightMissions]);

  useEffect(() => {
    if (adminSession?.authenticated) {
      return;
    }
    setMetadataEditMode(false);
    if (activeView === "video" && adminSession !== null) {
      setActiveView("map");
      setStatusText("Admin-tilgang kreves for denne visningen.");
      addLog("warn", "Beskyttet visning lukket uten admin-tilgang", null, { view: activeView });
    }
  }, [activeView, addLog, adminSession]);

  useEffect(() => {
    if (selectedYear !== "all" && !availableYears.includes(selectedYear)) {
      setSelectedYear(availableYears[0] ?? "all");
      setSelectedSeason("all");
    }
  }, [availableYears, selectedYear]);

  useEffect(() => {
    if (autoAppliedLatestFiltersRef.current) return;
    if (selectedYear !== "all" || selectedSeason !== "all") {
      autoAppliedLatestFiltersRef.current = true;
      return;
    }
    if (!latestAvailableCapturedDate) return;

    setSelectedYear(latestAvailableCapturedDate.slice(0, 4));
    setSelectedSeason(monthToSeason(latestAvailableCapturedDate.slice(5, 7)));
    autoAppliedLatestFiltersRef.current = true;
  }, [latestAvailableCapturedDate, selectedSeason, selectedYear]);

  useEffect(() => {
    if (selectedSeason === "all") return;
    const source = selectedYear === "all" ? timelineIndexed : timelineIndexed.filter((entry) => entry.year === selectedYear);
    const orthophotoSource =
      selectedYear === "all"
        ? orthophotoDates
        : orthophotoDates.filter((date) => date.startsWith(`${selectedYear}-`));
    const hasMatchingTimelineSeason = source.some((entry) => entry.season === selectedSeason);
    const hasMatchingOrthophotoSeason = orthophotoSource.some(
      (date) => monthToSeason(date.slice(5, 7)) === selectedSeason,
    );
    if (!hasMatchingTimelineSeason && !hasMatchingOrthophotoSeason) {
      setSelectedSeason("all");
    }
  }, [orthophotoDates, selectedSeason, selectedYear, timelineIndexed]);

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
        if (seq === photoLoadSeqRef.current) {
          setIsMapPhotosLoading(false);
        }
        return;
      }

      setIsMapPhotosLoading(true);

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
        const filteredPhotos = data.photos.filter(mapPhotoFilter);
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

          const filteredPage = data.photos.filter(mapPhotoFilter);
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
      } finally {
        if (seq === photoLoadSeqRef.current) {
          setIsMapPhotosLoading(false);
        }
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
    mapPhotoFilter,
    trackRequest,
    filteredTimelineHasData,
    setIsMapPhotosLoading,
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

      if (reset) {
        if (albumLoadingInitial) return;
      } else if (albumLoadingMore || !albumHasMore) {
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
        setAlbumLoadingInitial(true);
      } else {
        setAlbumLoadingMore(true);
      }
      setAlbumLoadFailed(false);

      const cursor = reset ? null : albumCursor;
      const pageQuery: Record<string, string | number | boolean> = {
        date: latestTimelineDate,
        mode: "cumulative",
        include_analysis: false,
        limit: 120,
        sort: "desc",
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

        const pagePhotos = data.photos;

        setAlbumPhotos((previous) => {
          if (reset) return pagePhotos;
          return mergePhotoPages(previous, pagePhotos);
        });
        setAlbumCursor(data.next_cursor ?? null);
        setAlbumHasMore(Boolean(data.next_cursor));
        setAlbumLoadFailed(false);
        if (reset) {
          setAlbumLoadedDate(latestTimelineDate);
        }
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

            const ordered = [...data.photos].sort(compareByCapturedAtThenId);
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
  }, [latestTimelineDate]);

  useEffect(() => {
    if (activeView !== "album") return;
    if (!latestTimelineDate) return;
    if (albumLoadFailed) return;

    if (albumLoadedDate !== latestTimelineDate) {
      void loadAlbumPage({ reset: true });
    }
  }, [activeView, albumLoadFailed, albumLoadedDate, latestTimelineDate, loadAlbumPage]);

  useEffect(() => {
    if (photosLoadFailed || !latestFilteredDate) {
      return;
    }

    setStatusText(buildPhotoStatusText(photos.length, selectedYear, selectedSeason, dayScope, selectedDate));
  }, [dayScope, latestFilteredDate, photos.length, photosLoadFailed, selectedDate, selectedSeason, selectedYear]);

  useEffect(() => {
    if (activeView === "album") {
      return;
    }
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
  }, [activeView, photos, hasExplicitDeepLink, syncSelectionToUrl]);

  useEffect(() => {
    if (activeView === "album") {
      return;
    }
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
  }, [activeView, photos, selectedDate, hasExplicitDeepLink, syncSelectionToUrl]);

  useEffect(() => {
    if (activeView !== "album") return;
    if (albumPhotos.length === 0) return;
    if (!syncSelectionToUrl && !hasExplicitDeepLink) return;

    setSelectedPhotoId((previous) => {
      if (
        initialPhotoRef.current &&
        albumPhotos.some((photo) => photoIdKey(photo.id) === photoIdKey(initialPhotoRef.current))
      ) {
        const initialAlbumPhoto = initialPhotoRef.current;
        initialPhotoRef.current = null;
        return initialAlbumPhoto;
      }
      initialPhotoRef.current = null;

      if (previous && albumPhotos.some((photo) => photoIdKey(photo.id) === photoIdKey(previous))) {
        return previous;
      }

      return previous;
    });
  }, [activeView, albumPhotos, hasExplicitDeepLink, syncSelectionToUrl]);

  useEffect(() => {
    if (activeProperties.length === 0 || !showPropertyLayer) {
      setPropertyJobs([]);
      if (activeProperties.length === 0) {
        setPropertyStatus("Ingen aktive eiendommer tilgjengelig.");
      }
      return;
    }

    void loadGardskartJobs(false);
  }, [activeProperties, loadGardskartJobs, showPropertyLayer]);

  useEffect(() => {
    const next = new URLSearchParams(window.location.search);

    if (activeView === "album" || activeView === "forest" || activeView === "import" || activeView === "video") {
      next.set("view", activeView === "forest" ? "skogbruk" : activeView);
    } else {
      next.delete("view");
    }

    if (selectedDate) {
      if (syncSelectionToUrl && activeView === "map") {
        next.set("date", selectedDate);
      } else {
        next.delete("date");
      }
    } else {
      next.delete("date");
    }

    const shouldPersistPhotoParam =
      syncSelectionToUrl &&
      Boolean(selectedPhotoId) &&
      (isPhotoViewerOpen || (activeView === "map" && selectedPhotoExistsInMap));

    if (!shouldPersistPhotoParam) {
      next.delete("photo");
    } else if (selectedPhotoId) {
      next.set("photo", selectedPhotoId);
    } else {
      next.delete("photo");
    }

    const query = next.toString();
    const target = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    window.history.replaceState({}, "", target);
  }, [activeView, isPhotoViewerOpen, selectedDate, selectedPhotoExistsInMap, selectedPhotoId, syncSelectionToUrl]);

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
    additional_properties: Array<{
      id?: number;
      komm: string;
      gnr: number;
      bnr: number;
      fnr?: number;
      label?: string;
    }>;
  }) => {
    if (!ensureAdminAccess("profilendringer")) return;

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
      const updatedProperties = [data.property, ...(data.additional_properties ?? [])].filter(
        (property): property is Property => property !== null,
      );
      await loadGardskartJobs(true, { properties: updatedProperties });
    }
  };

  const handleExportFlightMission = useCallback(
    async (missionId: number) => {
      if (!ensureAdminAccess("eksport av flyoppdrag")) return;

      setFlightMissionExportBusyId(missionId);
      try {
        const response = await trackRequest(() =>
          fetch(`/api/v1/flight-missions/${missionId}/export`, {
            method: "POST",
            credentials: "same-origin",
            headers: {
              Accept: "application/vnd.google-earth.kmz,application/zip,application/json",
            },
          }),
        );

        if (!response.ok) {
          const payload = await readResponsePayload(response);
          throw new ApiError({
            message: responseErrorText(payload, response),
            status: response.status,
            requestId: response.headers.get("X-Request-ID"),
            detail: payload,
          });
        }

        const blob = await response.blob();
        const exportFormat = response.headers.get("X-Flyvendebonder-Export-Format");
        const filename = filenameFromDisposition(
          response.headers.get("Content-Disposition"),
          `flyvendebonder-oppdrag-${missionId}.kmz`,
        );
        const objectUrl = window.URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = filename;
        anchor.rel = "noopener";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.URL.revokeObjectURL(objectUrl);

        const requestId = response.headers.get("X-Request-ID");
        const mission = flightMissions.find((item) => item.id === missionId);
        setFlightMissionStatus(`Eksporterte ${mission?.name ?? `oppdrag ${missionId}`} som ${describeMissionExportFormat(exportFormat)}.`);
        addLog("info", "Flyoppdrag eksportert", requestId, {
          missionId,
          filename,
          exportFormat,
        });
      } catch (error) {
        const apiError = error as ApiError;
        setFlightMissionStatus(`Kunne ikke eksportere flyoppdrag: ${apiError.message}`);
        addLog("error", "Kunne ikke eksportere flyoppdrag", apiError.requestId, apiError.detail);
      } finally {
        setFlightMissionExportBusyId(null);
      }
    },
    [addLog, ensureAdminAccess, flightMissions, trackRequest],
  );

  const handleDeleteFlightMission = useCallback(
    async (missionId: number) => {
      if (!ensureAdminAccess("sletting av flyoppdrag")) return;
      const mission = flightMissions.find((item) => item.id === missionId);
      const confirmed = window.confirm(`Slette ${mission?.name ?? `oppdrag ${missionId}`} permanent?`);
      if (!confirmed) return;

      setFlightMissionDeleteBusyId(missionId);
      try {
        const { requestId } = await trackRequest(() => apiDelete(`/api/v1/flight-missions/${missionId}`));
        setFlightMissions((current) => current.filter((item) => item.id !== missionId));
        setActiveFlightMissionId((current) => (current === missionId ? null : current));
        setFlightMissionStatus(`Slettet ${mission?.name ?? `oppdrag ${missionId}`}.`);
        addLog("info", "Flyoppdrag slettet", requestId, { missionId });
      } catch (error) {
        const apiError = error as ApiError;
        setFlightMissionStatus(`Kunne ikke slette flyoppdrag: ${apiError.message}`);
        addLog("error", "Kunne ikke slette flyoppdrag", apiError.requestId, apiError.detail);
      } finally {
        setFlightMissionDeleteBusyId(null);
      }
    },
    [addLog, ensureAdminAccess, flightMissions, trackRequest],
  );

  const handleSelectFlightMission = useCallback((missionId: number | null) => {
    if (missionId == null) {
      setActiveFlightMissionId(null);
      setFlightMissionStatus("Klar for ny plan i planlegging.");
      return;
    }
    setActiveFlightMissionId(missionId);
    setFlightMissionFocusToken((current) => current + 1);
    const mission = flightMissions.find((item) => item.id === missionId);
    if (!mission) return;
    setFlightMissionStatus(`Viser ${mission.name} i planlegging.`);
  }, [flightMissions]);

  const handleAdminLogin = useCallback(async (code: string) => {
    setIsAdminSessionBusy(true);
    clearPrivateProfileState();
    setAdminSession((current) =>
      current
        ? {
            ...current,
            authenticated: false,
            expires_at: null,
          }
        : current,
    );
    try {
      const { data, requestId } = await trackRequest(() =>
        apiPost<AdminSessionStatus>("/api/v1/admin/login", { code }),
      );
      await loadProfile();
      setAdminSession(data);
      addLog("info", "Admin-tilgang aktivert", requestId, {
        expiresAt: data.expires_at,
      });
      setStatusText("Admin-tilgang aktiv.");
    } catch (error) {
      const apiError = error as ApiError;
      clearPrivateProfileState();
      setAdminSession({
        configured: true,
        authenticated: false,
        expires_at: null,
      });
      try {
        await logoutAdminAndLoadPublicProfile();
      } catch (logoutError) {
        const logoutApiError = logoutError as ApiError;
        addLog("warn", "Kunne ikke rydde delvis admin-innlogging", logoutApiError.requestId, logoutApiError.detail);
      }
      addLog("error", "Admin-innlogging feilet", apiError.requestId, apiError.detail);
      setStatusText(`Admin-innlogging feilet: ${apiError.message}`);
      throw apiError;
    } finally {
      setIsAdminSessionBusy(false);
    }
  }, [addLog, clearPrivateProfileState, loadProfile, logoutAdminAndLoadPublicProfile, trackRequest]);

  const handleAdminLogout = useCallback(async () => {
    setIsAdminSessionBusy(true);
    try {
      const { requestId } = await trackRequest(logoutAdminAndLoadPublicProfile);
      setActiveView((current) => (current === "import" || current === "video" ? "map" : current));
      addLog("info", "Admin-tilgang slått av", requestId);
      setStatusText("Admin-tilgang slått av.");
    } catch (error) {
      const apiError = error as ApiError;
      addLog("error", "Kunne ikke logge ut admin", apiError.requestId, apiError.detail);
      setStatusText(`Kunne ikke logge ut admin: ${apiError.message}`);
      throw apiError;
    } finally {
      setIsAdminSessionBusy(false);
    }
  }, [addLog, logoutAdminAndLoadPublicProfile, trackRequest]);

  const handleStartMediaImport = useCallback(() => {
    if (!BROWSER_MEDIA_IMPORT_ENABLED) {
      setMediaImportError(BROWSER_MEDIA_IMPORT_DISABLED_REASON);
      setStatusText(BROWSER_MEDIA_IMPORT_DISABLED_REASON);
      addLog("warn", "Browserimport er deaktivert til kontrakten er ryddet", null, { issue: 54 });
      return;
    }
    handleClosePhotoViewer();
    setMediaImportError("");
    setMediaImportSummary("");
    setActiveView("import");
    if (isAdminAuthenticated) {
      addLog("info", "Import åpnet");
    } else {
      setStatusText("Admin-tilgang kreves for import.");
      addLog("warn", "Import åpnet uten aktiv admin-tilgang");
    }
  }, [addLog, handleClosePhotoViewer, isAdminAuthenticated]);

  const handleSubmitMediaImport = useCallback(
    async ({ images, videos }: MediaImportSelection): Promise<boolean> => {
      if (!ensureAdminAccess("import")) {
        setMediaImportError("Admin-tilgang kreves for import.");
        return false;
      }

      if (!BROWSER_MEDIA_IMPORT_ENABLED) {
        setMediaImportError(BROWSER_MEDIA_IMPORT_DISABLED_REASON);
        setStatusText(BROWSER_MEDIA_IMPORT_DISABLED_REASON);
        addLog("warn", "Blokkerte browserimport mot manglende backend-kontrakt", null, { issue: 54 });
        return false;
      }

      if (images.length === 0) {
        setMediaImportError(videos.length > 0 ? VIDEO_WORKFLOW_DISABLED_REASON : "Velg minst én bildefil.");
        return false;
      }

      if (videos.length > 0) {
        setMediaImportError(VIDEO_WORKFLOW_DISABLED_REASON);
        setStatusText(VIDEO_WORKFLOW_DISABLED_REASON);
        addLog("warn", "Blokkerte videoimport fra bildeimport", null, { issue: 139 });
        return false;
      }

      setIsMediaImportSubmitting(true);
      setMediaImportError("");
      setMediaImportSummary("");

      try {
        const formData = new FormData();
        images.forEach(({ file }) => {
          formData.append("files", file, file.name);
        });

        const stagingResponse = await trackRequest(() =>
          fetch("/api/v1/media-staging-jobs", {
            method: "POST",
            credentials: "same-origin",
            headers: {
              Accept: "application/json",
            },
            body: formData,
          }),
        );
        const stagingPayload = await readResponsePayload(stagingResponse);
        if (!stagingResponse.ok) {
          throw new Error(responseErrorText(stagingPayload, stagingResponse));
        }

        const stagingJob = (stagingPayload as MediaStagingEnvelope | null)?.job;
        if (!stagingJob?.job_id) {
          throw new Error("Backend returnerte ikke stagingjobb for bildeimport.");
        }

        addLog("info", "Bildeimport staged", stagingResponse.headers.get("X-Request-ID"), {
          jobId: stagingJob.job_id,
          files: stagingJob.counts.total,
          images: stagingJob.counts.image_count,
          rejected: stagingJob.counts.rejected_count,
        });

        const finalizeResponse = await trackRequest(() =>
          fetch(`/api/v1/media-staging-jobs/${encodeURIComponent(stagingJob.job_id)}/finalize`, {
            method: "POST",
            credentials: "same-origin",
            headers: {
              Accept: "application/json",
            },
          }),
        );
        const finalizePayload = await readResponsePayload(finalizeResponse);
        if (!finalizeResponse.ok) {
          throw new Error(responseErrorText(finalizePayload, finalizeResponse));
        }

        const result = (finalizePayload as MediaFinalizeEnvelope | null)?.result;
        if (!result) {
          throw new Error("Backend returnerte ikke importresultat.");
        }

        const summary = summarizeMediaFinalizeResult(result);
        addLog("info", "Bildeimport finalisert", finalizeResponse.headers.get("X-Request-ID"), {
          jobId: result.job_id,
          importRunId: result.import_run_id,
          imported: result.image_imported_count,
          skipped: result.image_skipped_count,
          rejected: result.rejected_count,
        });

        setMediaImportSummary(summary);
        setStatusText(summary);

        const timelineData = await loadTimeline();
        if (timelineData.dates.length > 0) {
          const latestIndex = timelineData.dates.length - 1;
          const latestDate = timelineData.dates[latestIndex]?.date ?? null;
          setSelectedIndex(latestIndex);
          if (latestDate) {
            setSelectedYear(latestDate.slice(0, 4));
          }
          setSelectedSeason("all");
        }
        setPhotoLoadRetryToken((current) => current + 1);
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Ukjent feil ved mediaimport.";
        setMediaImportError(message);
        setStatusText(`Mediaimport feilet: ${message}`);
        addLog("error", "Mediaimport feilet", null, { message });
        return false;
      } finally {
        setIsMediaImportSubmitting(false);
      }
    },
    [addLog, ensureAdminAccess, loadTimeline, trackRequest],
  );

  const handlePropertyTileError = useCallback(
    (jobId: string) => {
      if (tileRetryJobRef.current === jobId) {
        setShowPropertyLayer(false);
        setPropertyJobs([]);
        setPropertyStatus("Eiendomslag skrudd av automatisk etter tilgangsfeil fra NIBIO.");
        addLog("warn", "Eiendomslag skrudd av etter gjentatt tile-feil", null, { jobId });
        return;
      }

      tileRetryJobRef.current = jobId;
      addLog("warn", "Tile-feil i eiendomslag, prøver auto-refresh", null, { jobId });
      void loadGardskartJobs(true);
    },
    [addLog, loadGardskartJobs],
  );

  const handleSoilStatus = useCallback((text: string) => {
    if (text === "Jordsmonnlag aktivt.") {
      soilRetryCountRef.current = 0;
    }
    setSoilStatus(text);
  }, []);

  const handleSoilTileError = useCallback(() => {
    if (soilRetryCountRef.current >= 1) {
      soilRetryCountRef.current = 0;
      setShowSoilLayer(false);
      setSoilStatus("Jordsmonnlag skrudd av automatisk etter gjentatt tile-feil.");
      addLog("warn", "Jordsmonnlag skrudd av etter gjentatt tile-feil");
      return;
    }

    soilRetryCountRef.current += 1;
    addLog("warn", "Tile-feil i jordsmonnlag, prøver auto-refresh");
    setSoilRefreshToken((value) => value + 1);
  }, [addLog]);

  const handleBaseMapTileError = useCallback(
    (style: BaseMapStyle) => {
      if (style === "none") return;
      if (baseMapTileErrorRef.current === style) return;
      baseMapTileErrorRef.current = style;
      setStatusText(`Bakgrunnskart (${BASE_MAP_STYLES[style].label}) har delvis last-feil.`);
      addLog("warn", "Bakgrunnskart tile-feil", null, { style });
    },
    [addLog],
  );

  const handleVideoReview = useCallback(async (payload: VideoMapReviewPayload) => {
    if (!payload.jobId) return;
    if (!ensureAdminAccess("video-review")) return;
    if (payload.decision === "place_on_map" && !payload.map3dResult) {
      addLog("warn", "Kan ikke plassere videoresultat uten 3D-data", null, { jobId: payload.jobId });
      return;
    }

    const reviewState = payload.decision === "place_on_map" ? "placed" : payload.decision === "keep" ? "kept" : "discarded";
    const reviewResponse = await trackRequest(() =>
      fetch(`/api/v1/video-jobs/${encodeURIComponent(payload.jobId)}/review`, {
        method: "PUT",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          created_at: payload.createdAt,
          mode: payload.mode,
          review_state: reviewState,
          placement: payload.decision === "place_on_map" ? payload.placement : null,
        }),
      }),
    );
    const reviewPayload = await readResponsePayload(reviewResponse);
    if (!reviewResponse.ok) {
      throw new Error(responseErrorText(reviewPayload, reviewResponse));
    }

    const artifact: VideoMapArtifact = {
      jobId: payload.jobId,
      createdAt: payload.createdAt,
      mode: payload.mode,
      reviewState,
      placement: payload.decision === "place_on_map" ? payload.placement : null,
      map3dResult: payload.map3dResult,
    };

    setVideoMapArtifacts((previous) => [
      ...previous.filter((entry) => entry.jobId !== payload.jobId),
      artifact,
    ]);
    const storesRouteOnly = payload.mode === "frames" || !payload.map3dResult?.mesh_url;
    addLog(
      "info",
      payload.decision === "discard"
        ? "Videojobb kastet"
        : payload.decision === "place_on_map"
        ? storesRouteOnly
          ? "Videoløype lagt i kart"
          : "3D-resultat lagt ut"
        : storesRouteOnly
          ? "Videoløype lagret"
          : "3D-resultat lagret",
      null,
      {
        jobId: payload.jobId,
        decision: payload.decision,
      },
    );
  }, [addLog, ensureAdminAccess, trackRequest]);

  const handleArchiveVideoJob = useCallback((jobId: string) => {
    setArchivedVideoJobIds((current) => mergeUniqueJobIds(current, [jobId]));
    addLog("info", "Videojobb arkivert i køvisning", null, { jobId });
  }, [addLog]);

  const handleDropMissingVideoArtifact = useCallback((jobId: string) => {
    setVideoMapArtifacts((current) => current.filter((artifact) => artifact.jobId !== jobId));
    addLog("info", "Fjernet utdatert videoartefakt fra kartet", null, { jobId });
  }, [addLog]);

  const handleArchiveReviewedVideoJobs = useCallback((jobIds: string[]) => {
    if (jobIds.length === 0) return;
    setArchivedVideoJobIds((current) => mergeUniqueJobIds(current, jobIds));
    addLog("info", "Ferdigbehandlede videojobber arkivert i køvisning", null, {
      count: jobIds.length,
    });
  }, [addLog]);

  const handleRestoreArchivedVideoJobs = useCallback(() => {
    setArchivedVideoJobIds([]);
    addLog("info", "Arkiverte videojobber vist igjen");
  }, [addLog]);

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

  const handleToggleSoilLayer = useCallback((next: boolean) => {
    soilRetryCountRef.current = 0;
    setShowSoilLayer(next);
    if (!next) {
      setSoilStatus("Jordsmonnlag er skrudd av.");
      addLog("info", "Jordsmonnlag skrudd av av bruker");
      return;
    }

    setSoilStatus("Jordsmonnlag lastes ...");
    setSoilRefreshToken((value) => value + 1);
    addLog("info", "Jordsmonnlag skrudd på av bruker");
  }, [addLog]);

  const handleToggleForestLayer = useCallback((next: boolean) => {
    setShowForestLayer(next);
    setStatusText(next ? "Naturskogindikasjon vises i kartet." : "Naturskogindikasjon er skrudd av.");
    addLog("info", next ? "Naturskogindikasjon skrudd på" : "Naturskogindikasjon skrudd av");
  }, [addLog]);

  const handleTogglePropertyLayer = useCallback((next: boolean) => {
    if (next && activeProperties.length === 0) {
      setShowPropertyLayer(false);
      setPropertyJobs([]);
      setPropertyStatus("Ingen aktive eiendommer tilgjengelig.");
      addLog("warn", "Eiendomslag kan ikke skrus på uten aktiv eiendom");
      return;
    }

    setShowPropertyLayer(next);
    if (!next) {
      setPropertyJobs([]);
      setPropertyStatus("Eiendomslag er skrudd av.");
      addLog("info", "Eiendomslag skrudd av av bruker");
      return;
    }

    tileRetryJobRef.current = null;
    setPropertyStatus("Eiendomslag lastes ...");
    addLog("info", "Eiendomslag skrudd på av bruker");
  }, [activeProperties.length, addLog]);

  useEffect(() => {
    if (activeView === "album") return;
    setAlbumScrollSpin(false);
    if (albumScrollSpinTimeoutRef.current) {
      window.clearTimeout(albumScrollSpinTimeoutRef.current);
      albumScrollSpinTimeoutRef.current = null;
    }
  }, [activeView]);

  return (
    <div
      data-season={activeUiSeason}
      className={`relative h-screen overflow-hidden bg-canvas ${uiTheme === "satellite" ? "map-ui-satellite" : "map-ui-standard"}`}
    >
      <PhotoInspector
        open={isPhotoViewerOpen}
        selectedPhoto={selectedPhoto}
        selectedPhotoId={selectedPhotoId}
        selectedPhotoImageUrl={selectedPhotoImageUrl}
        selectedPhotoManualViewTarget={selectedPhotoManualViewTarget}
        stripPhotos={stripPhotos}
        hasPrevPhoto={hasPrevPhoto}
        hasNextPhoto={hasNextPhoto}
        baseMapStyle={baseMapStyle}
        metadataEditMode={metadataEditMode}
        showTechnicalMetadata={showTechnicalMetadata}
        metadataBusyPhotoId={metadataBusyPhotoId}
        analysisBusyPhotoId={analysisBusyPhotoId}
        isAdminAuthenticated={isAdminAuthenticated}
        metadataTagDraft={metadataTagDraft}
        metadataTagsDraft={metadataTagsDraft}
        metadataCaptionDraft={metadataCaptionDraft}
        metadataNeedsManualQcDraft={metadataNeedsManualQcDraft}
        metadataAltitudeDraft={metadataAltitudeDraft}
        metadataHeadingDraft={metadataHeadingDraft}
        metadataPitchDraft={metadataPitchDraft}
        metadataManualViewTargetDraft={metadataManualViewTargetDraft}
        activeInsetManualTarget={activeInsetManualTarget}
        hasMetadataChanges={hasMetadataChanges}
        onClose={handleClosePhotoViewer}
        onSelectPhoto={(photoId) => selectPhoto(photoId)}
        onStepPhoto={stepSelectedPhoto}
        onSetMetadataEditMode={setMetadataEditMode}
        onSetShowTechnicalMetadata={setShowTechnicalMetadata}
        onSetMetadataTagDraft={setMetadataTagDraft}
        onSetMetadataTagsDraft={setMetadataTagsDraft}
        onSetMetadataCaptionDraft={setMetadataCaptionDraft}
        onSetMetadataNeedsManualQcDraft={setMetadataNeedsManualQcDraft}
        onSetMetadataAltitudeDraft={setMetadataAltitudeDraft}
        onSetMetadataHeadingDraft={setMetadataHeadingDraft}
        onSetMetadataPitchDraft={setMetadataPitchDraft}
        onSetMetadataManualViewTargetDraft={setMetadataManualViewTargetDraft}
        onPhotoAnalysisAction={handlePhotoAnalysisAction}
        onCancelMetadataEdit={handleCancelMetadataEdit}
        onSavePhotoMetadata={handleSavePhotoMetadata}
      />

      <SidebarProvider>
        <div className="flex h-full overflow-hidden">
          <AppSidebar
            profile={profile}
            adminStatus={adminSession}
            adminBusy={isAdminSessionBusy}
            activeView={activeView}
            statusText={statusText}
            propertyStatus={propertyStatus}
            soilStatus={soilStatus}
            showSoilLayer={showSoilLayer}
            showPropertyLayer={showPropertyLayer}
            showOnlyManualQc={showOnlyManualQc}
            showOnlyLowConfidence={showOnlyLowConfidence}
            baseMapStyle={baseMapStyle}
            mapGrayscale={mapGrayscale}
            mapVintage={mapVintage}
            showZoomControls={showZoomControls}
            isLoading={isLoading}
            logoSpinActive={albumScrollSpin || isMapPhotosLoading}
            logs={logs}
            onClearLogs={() => setLogs([])}
            backendLogs={backendLogs}
            backendLogsLoading={isBackendLogsLoading}
            onClearBackendLogs={() => setBackendLogs([])}
            onFetchBackendLogs={loadBackendLogs}
            onToggleSoilLayer={handleToggleSoilLayer}
            onChangeBaseMapStyle={(style) => {
              baseMapTileErrorRef.current = null;
              setBaseMapStyle(style);
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
            onChangeShowZoomControls={(next) => {
              setShowZoomControls(next);
              addLog("info", next ? "Zoomknapper aktivert" : "Zoomknapper skjult");
            }}
            onChangeView={(view) => {
              handleClosePhotoViewer();
              setActiveView(view);
              addLog(
                "info",
                view === "album"
                  ? "Album åpnet"
                  : view === "orthophotos"
                    ? "Ortofotoene åpnet"
                  : view === "forest"
                    ? "Skogbruk åpnet"
                  : view === "planning"
                    ? "Planlegging åpnet"
                  : view === "import"
                    ? "Import åpnet"
                    : view === "video"
                      ? "Video åpnet"
                      : "Kart åpnet",
              );
            }}
            onTogglePropertyLayer={handleTogglePropertyLayer}
            onSaveProfile={handleSaveProfile}
            onAdminLogin={handleAdminLogin}
            onAdminLogout={handleAdminLogout}
            onStartMediaImport={BROWSER_MEDIA_IMPORT_ENABLED ? handleStartMediaImport : undefined}
            onToggleManualQcFilter={handleToggleManualQcFilter}
            onToggleLowConfidenceFilter={handleToggleLowConfidenceFilter}
          />

          <SidebarInset className="bg-canvas md:p-3 md:pl-0">
            <div className="relative h-full overflow-hidden md:rounded-[28px] md:border md:border-fb-border-subtle/80 md:bg-[color:var(--fb-surface-ghost)]/28 md:shadow-fb-floating">
              <div className="pointer-events-none absolute left-3 top-3 z-[860] sm:left-4 sm:top-4">
                <SidebarTrigger
                  className="fb-map-overlay-trigger pointer-events-auto inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-fb-border-subtle bg-fb-surface-page text-fb-text-primary shadow-fb-floating transition-colors hover:bg-fb-surface-ghost focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fb-season-solid md:hidden"
                  aria-label="Åpne meny"
                >
                  <Menu className="h-4 w-4" />
                </SidebarTrigger>
              </div>

              {activeView === "map" ? (
                <FilterPanel
                  selectedYear={selectedYear}
                  selectedSeason={selectedSeason}
                  availableYears={availableYears}
                  seasonCounts={seasonCounts}
                  onExpandedChange={setIsFilterExpanded}
                  onYearChange={(year) => {
                    const nextSeason = resolveSeasonForYearChange(year);
                    setSyncSelectionToUrl(true);
                    setSelectedYear(year);
                    setSelectedSeason(nextSeason);
                    setDayScope("all");
                    setMapResetToken((value) => value + 1);
                    addLog("info", "Årsfilter endret", null, { year, season: nextSeason });
                  }}
                  onSeasonChange={(season) => {
                    setSyncSelectionToUrl(true);
                    setSelectedSeason(season);
                    setDayScope("all");
                    setMapResetToken((value) => value + 1);
                    addLog("info", "Sesongfilter endret", null, { season });
                  }}
                />
              ) : null}

              {activeView === "map" && !photosLoadFailed ? (
                <MapLayerPanel
                  propertyCount={activeProperties.length}
                  showPropertyLayer={showPropertyLayer}
                  propertyStatus={propertyStatus}
                  onTogglePropertyLayer={handleTogglePropertyLayer}
                  showSoilLayer={showSoilLayer}
                  soilStatus={soilStatus}
                  onToggleSoilLayer={handleToggleSoilLayer}
                  showForestLayer={showForestLayer}
                  forestStatus={forestStatus}
                  onToggleForestLayer={handleToggleForestLayer}
                  colorAnalysisActive={colorAnalysisActive}
                  colorAnalysisAvailable={visibleMapOrthophotoOverlays.length > 0}
                  colorAnalysisStatus={colorAnalysisStatus}
                  onToggleColorAnalysis={(next) => {
                    if (operatingAreaTool.state.phase === "confirming") return;
                    if (next) operatingAreaTool.deactivate();
                    setColorAnalysisActive(next);
                    addLog("info", next ? "Fargeanalyse skrudd på" : "Fargeanalyse skrudd av");
                  }}
                  operatingAreaToolActive={operatingAreaTool.state.active}
                  onToggleOperatingAreaTool={(next) => {
                    if (operatingAreaTool.state.phase === "confirming") return;
                    if (next) setColorAnalysisActive(false);
                    operatingAreaTool.toggle(next);
                    addLog("info", next ? "Jordeverktøy skrudd på" : "Jordeverktøy skrudd av");
                  }}
                  baseMapStyle={baseMapStyle}
                  onChangeQuickBaseMap={(nextStyle) => {
                    if (baseMapStyle === nextStyle) {
                      return;
                    }
                    baseMapTileErrorRef.current = null;
                    setBaseMapStyle(nextStyle);
                    addLog("info", "Bakgrunnskart endret", null, { style: nextStyle, source: "quick-toggle" });
                  }}
                />
              ) : null}

              {activeView === "map" ? (
                <>
                  <MapCanvas
                  photos={photos}
                  selectedPhotoId={selectedPhotoId}
                  hoveredPhotoId={hoverPreviewPhotoId}
                  focusToken={mapFocusToken}
                  resetViewToken={mapResetToken}
                  orthophotoOverlays={visibleMapOrthophotoOverlays}
                  focusedOrthophotoId={focusedOrthophotoId}
                  orthophotoFocusToken={orthophotoFocusToken}
                  colorAnalysisActive={colorAnalysisActive}
                  onColorAnalysisActiveChange={(next) => {
                    if (next) operatingAreaTool.deactivate();
                    setColorAnalysisActive(next);
                  }}
                  operatingAreaToolActive={operatingAreaTool.state.active}
                  operatingAreaPreviewGeometry={operatingAreaTool.selectedCandidate?.geometry ?? null}
                  operatingAreaCenterInspectToken={operatingAreaCenterInspectToken}
                  onRequestOperatingAreaAt={operatingAreaTool.inspectPoint}
                  properties={activeProperties}
                  jobs={propertyJobs}
                  videoMapArtifacts={activeVideoMapArtifacts}
                  baseMapStyle={baseMapStyle}
                  mapGrayscale={mapGrayscale}
                  mapVintage={mapVintage}
                  showZoomControls={showZoomControls}
                  showSoilLayer={showSoilLayer}
                  showPropertyLayer={showPropertyLayer}
                  showForestLayer={showForestLayer}
                  soilRefreshToken={soilRefreshToken}
                  fieldPlots={[]}
                  activeFieldDraft={null}
                  flightMissions={[]}
                  activeFlightMissionId={null}
                  showMissionOverlay={false}
                  fieldCreateMode={false}
                  onRequestFieldCreateAt={() => undefined}
                  onSelectField={() => undefined}
                  onFieldGeometryChange={() => undefined}
                  onSelectPhoto={handleSelectPhoto}
                  onHoverPhoto={handleHoverPhoto}
                  onOpenPhotoFullscreen={handleOpenPhotoViewer}
                  onSoilStatus={handleSoilStatus}
                  onSoilTileError={handleSoilTileError}
                  onPropertyStatus={setPropertyStatus}
                  onPropertyTileError={handlePropertyTileError}
                  onBaseMapTileError={handleBaseMapTileError}
                  onDropMissingVideoArtifact={handleDropMissingVideoArtifact}
                  />
                  <OperatingAreaInspector
                    state={operatingAreaTool.state}
                    selectedCandidate={operatingAreaTool.selectedCandidate}
                    confirmation={operatingAreaTool.confirmation}
                    canConfirm={isAdminAuthenticated}
                    onSelectCandidate={operatingAreaTool.selectCandidate}
                    onConfirm={(relation) => void operatingAreaTool.confirm(relation)}
                    onInspectMapCenter={() => setOperatingAreaCenterInspectToken((value) => value + 1)}
                    onCancel={operatingAreaTool.deactivate}
                    onOpenPlanning={() => {
                      operatingAreaTool.deactivate();
                      setActiveView("planning");
                      addLog("info", "Planlegging åpnet fra jordeverktøy");
                    }}
                  />
                </>
              ) : activeView === "planning" ? (
                <PlanningPage
                  properties={activeProperties}
                  canEdit={isAdminAuthenticated}
                  photos={photos}
                  missions={flightMissions}
                  activeMissionId={activeFlightMissionId}
                  missionFocusToken={flightMissionFocusToken}
                  missionExportBusyId={flightMissionExportBusyId}
                  missionDeleteBusyId={flightMissionDeleteBusyId}
                  baseMapStyle={baseMapStyle}
                  mapGrayscale={mapGrayscale}
                  mapVintage={mapVintage}
                  onSelectMission={handleSelectFlightMission}
                  onExportMission={handleExportFlightMission}
                  onDeleteMission={handleDeleteFlightMission}
                  onReloadMissions={() => loadFlightMissions({ silent: true })}
                  onReloadProfile={() => loadProfile()}
                />
              ) : activeView === "album" ? (
                <AlbumPage
                  availableYears={availableYears}
                  photos={albumPhotos}
                  isLoading={albumLoadingInitial}
                  isLoadingMore={albumLoadingMore}
                  hasMore={albumHasMore}
                  loadFailed={albumLoadFailed}
                  onLoadMore={handleLoadMoreAlbum}
                  onOpenPhoto={handleOpenPhotoViewer}
                  onScrollActivity={handleAlbumScrollActivity}
                />
              ) : activeView === "orthophotos" ? (
                <OrthophotoPage
                  overlays={activeOrthophotoOverlays}
                  onOpenInMap={(overlayId) => {
                    const overlay = DEV_ORTHOPHOTO_OVERLAYS.find((item) => item.id === overlayId);
                    if (!overlay) return;
                    setSyncSelectionToUrl(true);
                    setSelectedYear(overlay.capturedDate.slice(0, 4));
                    setSelectedSeason(monthToSeason(overlay.capturedDate.slice(5, 7)));
                    setFocusedOrthophotoId(overlayId);
                    setOrthophotoFocusToken((value) => value + 1);
                    setActiveView("map");
                    addLog("info", "Ortofoto åpnet i kart", null, { overlayId });
                  }}
                />
              ) : activeView === "forest" ? (
                <SkogbrukPage
                  overlays={activeOrthophotoOverlays}
                  showForestLayer={showForestLayer}
                  onToggleForestLayer={handleToggleForestLayer}
                  onOpenInMap={(overlayId) => {
                    const overlay = DEV_ORTHOPHOTO_OVERLAYS.find((item) => item.id === overlayId);
                    if (!overlay) return;
                    setSyncSelectionToUrl(true);
                    setSelectedYear(overlay.capturedDate.slice(0, 4));
                    setSelectedSeason(monthToSeason(overlay.capturedDate.slice(5, 7)));
                    setFocusedOrthophotoId(overlayId);
                    setOrthophotoFocusToken((value) => value + 1);
                    setShowForestLayer(true);
                    setActiveView("map");
                    addLog("info", "Skogflate åpnet i kart", null, { overlayId });
                  }}
                />
              ) : activeView === "import" ? (
                <MediaImportPage
                  busy={isMediaImportSubmitting}
                  errorMessage={mediaImportError}
                  successMessage={mediaImportSummary}
                  disabledMessage={
                    BROWSER_MEDIA_IMPORT_ENABLED
                      ? isAdminAuthenticated
                        ? null
                        : "Admin-tilgang kreves for import."
                      : BROWSER_MEDIA_IMPORT_DISABLED_REASON
                  }
                  onImport={handleSubmitMediaImport}
                />
              ) : (
                <VideoPage
                  baseMapStyle={baseMapStyle}
                  showZoomControls={showZoomControls}
                  disabledMessage={VIDEO_WORKFLOW_ENABLED ? null : VIDEO_WORKFLOW_DISABLED_REASON}
                  onVideoReview={isAdminAuthenticated ? handleVideoReview : undefined}
                  initialJobIds={initialVideoJobIds}
                  reviewedArtifacts={videoMapArtifacts}
                  archivedJobIds={archivedVideoJobIds}
                  onArchiveJob={handleArchiveVideoJob}
                  onArchiveReviewedJobs={handleArchiveReviewedVideoJobs}
                  onRestoreArchivedJobs={handleRestoreArchivedVideoJobs}
                  onStartMediaImport={BROWSER_MEDIA_IMPORT_ENABLED && isAdminAuthenticated ? handleStartMediaImport : undefined}
                />
              )}

              {activeView === "map" && photosLoadFailed ? (
                <div className="pointer-events-none absolute left-1/2 top-3 z-[980] -translate-x-1/2 px-3 md:top-4">
                  <div className="fb-map-overlay-alert pointer-events-auto inline-flex flex-wrap items-center gap-2 rounded-xl border border-[color:var(--fb-accent-danger)]/75 bg-fb-surface-page px-3 py-2 text-sm text-fb-text-primary">
                    <span>Kunne ikke laste bilder for valgt filter.</span>
                    <Button type="button" size="sm" variant="outline" onClick={handleRetryPhotoLoad}>
                      <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                      Prøv igjen
                    </Button>
                  </div>
                </div>
              ) : null}

              {activeView === "map" && hoverPreviewPhoto && hoverPreviewImageUrl && !isPhotoViewerOpen && !isFilterExpanded && !photosLoadFailed ? (
                <div className="fb-map-hover-preview-anchor pointer-events-none absolute z-[760] hidden md:block">
                  <div className="fb-map-overlay-preview overflow-hidden rounded-2xl border border-fb-border-subtle bg-fb-surface-page p-2">
                    <img
                      src={hoverPreviewImageUrl}
                      alt={hoverPreviewPhoto.title || "Forhåndsvisning"}
                      className="block h-[min(32vw,320px)] w-[min(32vw,320px)] min-h-[220px] min-w-[220px] rounded-xl object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </SidebarInset>
        </div>
      </SidebarProvider>
    </div>
  );
}
