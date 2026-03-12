import { useCallback, useEffect, useMemo, useState } from "react";
import { Clapperboard, Loader2, MapPin } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageShell, Section, Stack } from "@/components/ui/layout-primitives";
import type {
  VideoMapArtifact,
  VideoMap3dResultInfo,
  VideoFramesResultInfo,
  VideoMapReviewDecision,
  VideoMapReviewPayload,
} from "@/types";
import { BASE_MAP_STYLES, type BaseMapStyle } from "@/lib/map-styles";
import { cn } from "@/lib/utils";
import { VideoRouteMap } from "@/components/video-route-map";

type VideoJobStatus = "pending" | "processing" | "done" | "failed";

interface VideoPageProps {
  baseMapStyle: BaseMapStyle;
  showZoomControls: boolean;
  disabledMessage?: string | null;
  initialJobIds?: string[];
  reviewedArtifacts?: VideoMapArtifact[];
  archivedJobIds?: string[];
  onArchiveJob?: (jobId: string) => void;
  onArchiveReviewedJobs?: (jobIds: string[]) => void;
  onRestoreArchivedJobs?: () => void;
  onStartMediaImport?: () => void;
  onVideoReview?: (payload: VideoMapReviewPayload) => Promise<void> | void;
}

interface MetadataRow {
  key: string;
  value: string;
}

interface RouteStats {
  segmentCount: number;
  pointCount: number;
  startPoint: { lat: number; lng: number } | null;
  endPoint: { lat: number; lng: number } | null;
}

interface VideoJobState {
  jobId: string | null;
  status: VideoJobStatus;
  mode: string | null;
  statusText: string;
  message: string | null;
  result: unknown;
  raw: unknown;
  updatedAt: string;
}

function mergeJobIds(current: string[], incoming: string[]): string[] {
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

const STATUS_UI: Record<VideoJobStatus, { label: string; toneClass: string }> = {
  pending: {
    label: "Venter",
    toneClass: "border-fb-border-subtle bg-fb-surface-ghost text-fb-text-secondary",
  },
  processing: {
    label: "Prosesserer",
    toneClass: "border-[color:var(--fb-season-solid)]/35 bg-[color:var(--fb-season-solid)]/10 text-fb-text-primary",
  },
  done: {
    label: "Ferdig",
    toneClass: "border-[color:var(--fb-accent-success)]/35 bg-[color:var(--fb-accent-success)]/10 text-fb-text-primary",
  },
  failed: {
    label: "Feilet",
    toneClass: "border-[color:var(--fb-accent-danger)]/35 bg-[color:var(--fb-accent-danger)]/10 text-fb-text-primary",
  },
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toStringValue(value: unknown): string | null {
  if (typeof value === "string") {
    const next = value.trim();
    return next.length > 0 ? next : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function normalizeJobStatus(value: unknown): VideoJobStatus {
  const raw = toStringValue(value)?.toLowerCase() ?? "";
  if (!raw) return "pending";

  if (["failed", "error", "cancelled", "canceled", "aborted"].some((entry) => raw.includes(entry))) {
    return "failed";
  }
  if (["done", "completed", "success", "succeeded", "finished", "ready"].some((entry) => raw.includes(entry))) {
    return "done";
  }
  if (["processing", "running", "started", "in_progress", "in-progress", "working"].some((entry) => raw.includes(entry))) {
    return "processing";
  }
  if (["pending", "queued", "created", "submitted", "waiting"].some((entry) => raw.includes(entry))) {
    return "pending";
  }

  return "pending";
}

function normalizeJob(payload: unknown, fallbackJobId: string | null): VideoJobState {
  const root = asRecord(payload);
  const job = asRecord(root?.job) ?? root;

  const statusRaw =
    job?.status ??
    job?.state ??
    job?.job_status ??
    root?.status ??
    root?.state ??
    root?.job_status ??
    "pending";
  const status = normalizeJobStatus(statusRaw);
  const statusText = toStringValue(statusRaw) ?? status;
  const message =
    toStringValue(job?.message) ??
    toStringValue(job?.detail) ??
    toStringValue(root?.message) ??
    toStringValue(root?.detail) ??
    null;

  const resultCandidateObjects = [
    job?.result,
    job?.output,
    job?.outputs,
    job?.artifacts,
    root?.result,
    root?.output,
    root?.outputs,
    root?.artifacts,
    job?.result_map3d,
    job?.result_frames,
    job?.resultMap3d,
    job?.resultFrames,
    root?.result_map3d,
    root?.result_frames,
    root?.resultMap3d,
    root?.resultFrames,
  ];
  const result = resultCandidateObjects.find((entry) => entry !== undefined && entry !== null) ?? null;
  const jobId =
    toStringValue(job?.job_id) ??
    toStringValue(job?.id) ??
    toStringValue(root?.job_id) ??
    toStringValue(root?.id) ??
    fallbackJobId;

  return {
    jobId,
    mode: toStringValue(job?.mode) ?? toStringValue(root?.mode) ?? null,
    status,
    statusText,
    message,
    result,
    raw: payload,
    updatedAt: new Date().toISOString(),
  };
}

function extractMap3dResult(raw: unknown): VideoMap3dResultInfo | null {
  const record = asRecord(raw);
  if (!record) return null;

  const candidate =
    asRecord(record.result_map3d) ??
    asRecord(record.resultMap3d) ??
    record;

  const stitch_job_id = toStringValue(candidate.stitch_job_id) ?? toStringValue(candidate.stitchJobId);
  const preview_image = toStringValue(candidate.preview_image) ?? toStringValue(candidate.previewImage);
  const mesh_url = toStringValue(candidate.mesh_url) ?? toStringValue(candidate.meshUrl);
  const geodata_geojson =
    toStringValue(candidate.geodata_geojson) ?? toStringValue(candidate.geodataGeojson);
  const epsg = toStringValue(candidate.epsg) ?? "EPSG:4326";
  const metadata_json = toStringValue(candidate.metadata_json) ?? toStringValue(candidate.metadataJson);

  if (!geodata_geojson && !preview_image && !mesh_url) {
    return null;
  }

  return {
    stitch_job_id,
    preview_image,
    mesh_url,
    geodata_geojson,
    metadata_json,
    epsg,
  };
}

function extractFramesResult(raw: unknown): VideoFramesResultInfo | null {
  const record = asRecord(raw);
  if (!record) return null;
  if (record.result_frames) return extractFramesResult(record.result_frames);
  if (record.resultFrames) return extractFramesResult(record.resultFrames);

  const frameCount = toStringValue(record.frame_count) ? Number(record.frame_count) : Number(record.frame_count);
  const fps = toStringValue(record.fps) ? Number(record.fps) : Number(record.fps);
  const sample_frames_raw = record.sample_frames ?? record.sampleFrames;
  if (!Number.isFinite(frameCount) || !Number.isFinite(fps)) {
    return null;
  }

  const sampleFrames: VideoFramesResultInfo["sample_frames"] = [];
  if (Array.isArray(sample_frames_raw)) {
    sample_frames_raw.forEach((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
      const row = entry as Record<string, unknown>;
      const index = Number(row.index);
      const timestampMs = Number(row.timestamp_ms);
      const imageUrl = toStringValue(row.image_url);
      if (!Number.isFinite(index) || !Number.isFinite(timestampMs) || !imageUrl) {
        return;
      }
      sampleFrames.push({
        index: Math.trunc(index),
        timestamp_ms: Math.trunc(timestampMs),
        image_url: imageUrl,
      });
    });
  }

  const archiveUrl =
    toStringValue(record.archive_url) ??
    toStringValue(record.archiveUrl) ??
    (typeof record.archive === "string" ? record.archive : null);
  const selectedFrameCount = Number(record.selected_frame_count ?? record.selectedFrameCount ?? sampleFrames.length);
  const routeDistance = Number(record.route_distance_m ?? record.routeDistanceM);
  const stepDistance = Number(record.step_distance_m ?? record.stepDistanceM);

  return {
    frame_count: Math.trunc(frameCount),
    fps: Math.trunc(Math.max(1, fps)),
    selected_frame_count: Number.isFinite(selectedFrameCount) ? Math.max(0, Math.trunc(selectedFrameCount)) : sampleFrames.length,
    route_distance_m: Number.isFinite(routeDistance) ? routeDistance : null,
    step_distance_m: Number.isFinite(stepDistance) ? stepDistance : null,
    sample_frames: sampleFrames,
    archive_url: archiveUrl ?? null,
  };
}

function readMap3dResultFromJob(job: VideoJobState): VideoMap3dResultInfo | null {
  const candidates: unknown[] = [job.result, job.raw];
  const root = asRecord(job.raw);
  if (root) {
    if (root.result_map3d || root.resultMap3d) candidates.push(root.result_map3d, root.resultMap3d);
    if (root.job && typeof root.job === "object") candidates.push(root.job);
    if (asRecord(root.job)?.result_map3d || asRecord(root.job)?.resultMap3d) {
      candidates.push(asRecord(root.job)?.result_map3d, asRecord(root.job)?.resultMap3d);
    }
  }

  for (const candidate of candidates) {
    const normalized = extractMap3dResult(candidate);
    if (normalized) return normalized;
  }

  return null;
}

function extractResultSummary(job: VideoJobState): unknown | null {
  const root = asRecord(job.raw);
  const rootJob = asRecord(root?.job);

  const candidates: unknown[] = [
    job.result,
    root,
    rootJob,
    root?.result_map3d,
    root?.resultMap3d,
    root?.result_frames,
    root?.resultFrames,
    rootJob?.result_map3d,
    rootJob?.resultMap3d,
    rootJob?.result_frames,
    rootJob?.resultFrames,
  ];

  const summaryCandidate = candidates.find((candidate) => {
    if (candidate == null) return false;
    if (typeof candidate !== "object" || Array.isArray(candidate)) return false;
    return Object.keys(candidate as Record<string, unknown>).length > 0;
  });

  if (summaryCandidate == null) return null;
  if (asRecord(summaryCandidate)?.job_id || asRecord(summaryCandidate)?.jobId) {
    return summaryCandidate;
  }

  return {
    job_id: job.jobId,
    status: job.status,
    mode: job.mode,
    result: summaryCandidate,
    message: job.message,
  } as Record<string, unknown>;
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

function buildErrorText(response: Response, payload: unknown): string {
  if (typeof payload === "string" && payload.trim().length > 0) {
    return payload;
  }

  const parsed = asRecord(payload);
  const detail = toStringValue(parsed?.detail);
  if (detail) return detail;
  const message = toStringValue(parsed?.message);
  if (message) return message;
  const error = toStringValue(parsed?.error);
  if (error) return error;

  return `Request feilet med status ${response.status}`;
}

function formatUpdatedAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("nb-NO", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatTimestampMs(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${(value / 1000).toFixed(1)} s`;
}

function formatCoordinate(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return value.toFixed(6);
}

function formatDistanceMeters(value: number | null | undefined): string {
  if (!Number.isFinite(value ?? NaN) || value == null) return "—";
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)} km`;
  }
  return `${Math.round(value)} m`;
}

function formatPlacement(placement: { lat: number; lng: number } | null): string {
  if (!placement) return "Rute-start";
  return `${formatCoordinate(placement.lat)}, ${formatCoordinate(placement.lng)}`;
}

function labelReviewState(value: VideoMapArtifact["reviewState"] | null | undefined): string {
  if (value === "placed") return "Lagt i kart";
  if (value === "kept") return "Lagret";
  if (value === "discarded") return "Kastet";
  return "Ubehandlet";
}

function toPlacementFromLatLng(latLng: [number, number] | null): { lat: number; lng: number } | null {
  if (!latLng) return null;
  return { lat: latLng[0], lng: latLng[1] };
}

function formatRouteStats(stats: RouteStats | null): string {
  if (!stats) return "Ingen rute lastet";
  return `${stats.segmentCount} segment${stats.segmentCount === 1 ? "" : "er"} · ${stats.pointCount} punkter`;
}

function pushMetadataRows(source: unknown, out: MetadataRow[], prefix = "", depth = 0): void {
  if (depth > 6) {
    if (prefix) {
      out.push({ key: prefix, value: "[for mange nivåer]" });
    }
    return;
  }

  if (source == null) {
    if (prefix) {
      out.push({ key: prefix, value: "—" });
    }
    return;
  }

  if (typeof source === "string" || typeof source === "number" || typeof source === "boolean") {
    if (prefix) {
      out.push({ key: prefix, value: String(source) });
    }
    return;
  }

  if (Array.isArray(source)) {
    if (!source.length) {
      if (prefix) {
        out.push({ key: prefix, value: "[]" });
      }
      return;
    }

    source.forEach((entry, index) => {
      pushMetadataRows(entry, out, `${prefix}[${index}]`, depth + 1);
    });
    return;
  }

  if (typeof source === "object") {
    const record = source as Record<string, unknown>;
    const keys = Object.keys(record);
    if (!keys.length && prefix) {
      out.push({ key: prefix, value: "{}" });
      return;
    }

    keys.forEach((key) => {
      const nextPrefix = prefix.length > 0 ? `${prefix}.${key}` : key;
      pushMetadataRows(record[key], out, nextPrefix, depth + 1);
    });
    return;
  }

  if (prefix) {
    out.push({ key: prefix, value: String(source) });
  }
}

export function VideoPage({
  baseMapStyle,
  showZoomControls,
  disabledMessage,
  initialJobIds = [],
  reviewedArtifacts = [],
  archivedJobIds = [],
  onArchiveJob,
  onArchiveReviewedJobs,
  onRestoreArchivedJobs,
  onStartMediaImport,
  onVideoReview,
}: VideoPageProps) {
  const videoWorkflowDisabled = Boolean(disabledMessage);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [jobIds, setJobIds] = useState<string[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [jobsById, setJobsById] = useState<Record<string, VideoJobState>>({});
  const [reviewDecision, setReviewDecision] = useState<VideoMapReviewDecision | null>(null);
  const [isReviewSubmitting, setIsReviewSubmitting] = useState(false);
  const [showArchivedJobs, setShowArchivedJobs] = useState(false);
  const [routeStats, setRouteStats] = useState<RouteStats | null>(null);
  const [metadataPayload, setMetadataPayload] = useState<Record<string, unknown> | null>(null);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [metadataError, setMetadataError] = useState<string | null>(null);

  const queuedJobs = useMemo(
    () =>
      jobIds.map((jobId) => jobsById[jobId] ?? {
        jobId,
        status: "pending" as VideoJobStatus,
        mode: null,
        statusText: "Laster",
        message: null,
        result: null,
        raw: null,
        updatedAt: new Date(0).toISOString(),
      }),
    [jobIds, jobsById],
  );
  const archivedJobIdSet = useMemo(() => new Set(archivedJobIds), [archivedJobIds]);
  const visibleQueuedJobs = useMemo(
    () => (showArchivedJobs ? queuedJobs : queuedJobs.filter((entry) => !entry.jobId || !archivedJobIdSet.has(entry.jobId))),
    [archivedJobIdSet, queuedJobs, showArchivedJobs],
  );
  const job = useMemo(() => {
    if (selectedJobId && (showArchivedJobs || !archivedJobIdSet.has(selectedJobId))) {
      return jobsById[selectedJobId] ?? queuedJobs.find((entry) => entry.jobId === selectedJobId) ?? null;
    }
    return visibleQueuedJobs[0] ?? queuedJobs[0] ?? null;
  }, [archivedJobIdSet, jobsById, queuedJobs, selectedJobId, showArchivedJobs, visibleQueuedJobs]);
  const processingJobCount = useMemo(
    () => queuedJobs.filter((entry) => entry.status === "pending" || entry.status === "processing").length,
    [queuedJobs],
  );
  const archivedJobCount = archivedJobIds.length;
  const reviewedStateByJobId = useMemo(() => {
    const result = new Map<string, VideoMapArtifact["reviewState"]>();
    reviewedArtifacts.forEach((artifact) => {
      result.set(artifact.jobId, artifact.reviewState);
    });
    return result;
  }, [reviewedArtifacts]);
  const reviewedUnarchivedJobIds = useMemo(
    () =>
      queuedJobs
        .map((entry) => entry.jobId)
        .filter((jobId): jobId is string => Boolean(jobId) && reviewedStateByJobId.has(jobId as string) && !archivedJobIdSet.has(jobId as string)),
    [archivedJobIdSet, queuedJobs, reviewedStateByJobId],
  );
  const currentReviewState = useMemo(
    () => (job?.jobId ? reviewedStateByJobId.get(job.jobId) ?? null : null),
    [job?.jobId, reviewedStateByJobId],
  );
  const currentJobArchived = Boolean(job?.jobId && archivedJobIdSet.has(job.jobId));
  const nextUnreviewedJobId = useMemo(() => {
    const currentJobId = job?.jobId ?? null;
    const next = visibleQueuedJobs.find(
      (entry) => entry.jobId !== currentJobId && entry.jobId && !reviewedStateByJobId.has(entry.jobId),
    );
    return next?.jobId ?? null;
  }, [job?.jobId, reviewedStateByJobId, visibleQueuedJobs]);
  const statusUi = useMemo(() => (job ? STATUS_UI[job.status] : null), [job]);
  const resultJson = useMemo(() => {
    if (!job) return null;
    const summary = extractResultSummary(job);
    if (!summary) return null;
    try {
      return JSON.stringify(summary, null, 2);
    } catch {
      return String(summary);
    }
  }, [job]);
  const map3dResult = useMemo(() => {
    if (!job) return null;
    return readMap3dResultFromJob(job);
  }, [job]);
  const framesResult = useMemo(() => {
    if (!job) return null;
    return extractFramesResult(job.result) || extractFramesResult(job.raw) || null;
  }, [job]);
  const routeResult = useMemo(() => {
    if (!job?.jobId) return null;

    if (map3dResult) {
      return map3dResult;
    }

    if (job.mode === "frames") {
      return {
        stitch_job_id: "frames",
        preview_image: `/api/v1/video-jobs/${job.jobId}/preview.jpg`,
        mesh_url: null,
        geodata_geojson: `/api/v1/video-jobs/${job.jobId}/geodata.geojson`,
        metadata_json: `/api/v1/video-jobs/${job.jobId}/metadata.json`,
        epsg: "EPSG:4326",
      };
    }

    return {
      stitch_job_id: "job",
      preview_image: `/api/v1/video-jobs/${job.jobId}/preview.jpg`,
      mesh_url: null,
      geodata_geojson: `/api/v1/video-jobs/${job.jobId}/geodata.geojson`,
      metadata_json: `/api/v1/video-jobs/${job.jobId}/metadata.json`,
      epsg: "EPSG:4326",
    };
  }, [job?.jobId, job?.mode, map3dResult]);
  const isReadyForReview = Boolean(job?.jobId && job?.status === "done");
  const hasGeodata = Boolean(routeResult?.geodata_geojson);
  const canPlaceRoute = Boolean(job?.status === "done" && hasGeodata);
  const showRouteResult = Boolean(routeResult?.geodata_geojson && job?.status === "done");
  const mapStyleLabel = BASE_MAP_STYLES[baseMapStyle].label;
  const metadataRows = useMemo(() => {
    const rows: MetadataRow[] = [];
    if (!metadataPayload) {
      return rows;
    }

    pushMetadataRows(metadataPayload, rows);
    return rows;
  }, [metadataPayload]);
  const sampleFrames = framesResult?.sample_frames ?? [];

  const refreshJob = useCallback(async (jobId: string) => {
    if (videoWorkflowDisabled) return;
    const response = await fetch(`/api/v1/video-jobs/${encodeURIComponent(jobId)}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    const payload = await readResponsePayload(response);
    if (!response.ok) {
      throw new Error(buildErrorText(response, payload));
    }

    const parsed = normalizeJob(payload, jobId);
    setJobsById((previous) => {
      const existing = previous[jobId];
      return {
        ...previous,
        [jobId]: {
          ...existing,
          ...parsed,
          jobId: parsed.jobId ?? existing?.jobId ?? jobId,
        },
      };
    });
    setJobIds((current) => mergeJobIds(current, [jobId]));
  }, [videoWorkflowDisabled]);

  useEffect(() => {
    if (videoWorkflowDisabled) return;
    if (initialJobIds.length === 0) return;

    setJobIds((current) => mergeJobIds(initialJobIds, current));
    setSelectedJobId(initialJobIds[0] ?? null);
  }, [initialJobIds, videoWorkflowDisabled]);

  useEffect(() => {
    if (videoWorkflowDisabled) return;
    const missingJobIds = jobIds.filter((jobId) => !jobsById[jobId]);
    if (missingJobIds.length === 0) return;

    let active = true;

    void Promise.all(
      missingJobIds.map((currentJobId) =>
        refreshJob(currentJobId).catch((error) => {
          if (!active) return;
          setSubmitError(error instanceof Error ? error.message : "Kunne ikke hente videojobb.");
        }),
      ),
    );

    return () => {
      active = false;
    };
  }, [jobIds, jobsById, refreshJob, videoWorkflowDisabled]);

  useEffect(() => {
    if (videoWorkflowDisabled) return;
    const activeProcessingJobIds = jobIds.filter((jobId) => {
      const current = jobsById[jobId];
      return !current || current.status === "pending" || current.status === "processing";
    });
    if (activeProcessingJobIds.length === 0) return;

    let active = true;

    const poll = async () => {
      for (const currentJobId of activeProcessingJobIds) {
        try {
          await refreshJob(currentJobId);
        } catch (error) {
          if (!active) return;
          const message = error instanceof Error ? error.message : "Kunne ikke hente jobbstatus.";
          setJobsById((previous) => {
            const existing = previous[currentJobId];
            if (!existing) return previous;
            return {
              ...previous,
              [currentJobId]: {
                ...existing,
                message,
                updatedAt: new Date().toISOString(),
              },
            };
          });
        }
      }
    };

    void poll();
    const intervalId = window.setInterval(() => {
      void poll();
    }, 3200);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [jobIds, jobsById, refreshJob, videoWorkflowDisabled]);

  const handleAddRouteToMap = useCallback(async () => {
    if (videoWorkflowDisabled || !job?.jobId || !onVideoReview || !routeResult?.geodata_geojson) return;
    setIsReviewSubmitting(true);
    setSubmitError(null);
    try {
      await onVideoReview({
        jobId: job.jobId,
        createdAt: job.updatedAt,
        mode: job.mode ?? "frames",
        decision: "place_on_map",
        placement: null,
        map3dResult: routeResult,
      });
      setReviewDecision("place_on_map");
      if (nextUnreviewedJobId) {
        setSelectedJobId(nextUnreviewedJobId);
      }
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Kunne ikke lagre review.");
    } finally {
      setIsReviewSubmitting(false);
    }
  }, [job?.jobId, job?.mode, job?.updatedAt, nextUnreviewedJobId, onVideoReview, routeResult, videoWorkflowDisabled]);

  const handleArchiveCurrentJob = useCallback(() => {
    if (!job?.jobId || !onArchiveJob) return;
    onArchiveJob(job.jobId);
    const nextVisibleJob = visibleQueuedJobs.find((entry) => entry.jobId !== job.jobId)?.jobId ?? null;
    setSelectedJobId(nextVisibleJob);
  }, [job?.jobId, onArchiveJob, visibleQueuedJobs]);

  useEffect(() => {
    setReviewDecision(null);
  }, [job?.jobId, job?.status]);

  useEffect(() => {
    setRouteStats(null);
    setMetadataPayload(null);
    setMetadataError(null);
    setMetadataLoading(false);
  }, [job?.jobId]);

  useEffect(() => {
    if (videoWorkflowDisabled) return;
    const metadataUrl = routeResult?.metadata_json;
    if (!routeResult || job?.status !== "done" || !metadataUrl) {
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    const loadMetadata = async () => {
      try {
        setMetadataLoading(true);
        setMetadataError(null);

        const response = await fetch(metadataUrl, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Kunne ikke hente video-metadata (${response.status})`);
        }

        const payload = await readResponsePayload(response);
        if (cancelled) return;

        const recordPayload = asRecord(payload);
        if (recordPayload) {
          setMetadataPayload(recordPayload);
          return;
        }

        if (payload == null) {
          setMetadataPayload({});
          return;
        }

        setMetadataPayload({
          verdi: typeof payload === "string" ? payload : String(payload),
        });
      } catch (error) {
        if (cancelled || (error instanceof DOMException && error.name === "AbortError")) {
          return;
        }
        setMetadataError(error instanceof Error ? error.message : "Kunne ikke hente metadata.");
      } finally {
        if (!cancelled) {
          setMetadataLoading(false);
        }
      }
    };

    void loadMetadata();

    return () => {
      cancelled = true;
      controller.abort();
    };
    }, [job?.status, job?.jobId, routeResult, videoWorkflowDisabled]);

  if (videoWorkflowDisabled) {
    return (
      <div className="pointer-events-auto absolute inset-0 z-[620] overflow-y-auto">
        <div className="min-h-full bg-fb-surface-base px-3 pb-8 pt-20 sm:px-6 sm:pt-6">
          <PageShell maxWidth="content" className="px-0">
            <Section
              title="Videoflyt midlertidig utilgjengelig"
              description="Video-review er slått av til backend-kontrakten er ryddet."
              className="space-y-3"
            >
              <div className="rounded-2xl border border-fb-border-subtle bg-fb-surface-ghost px-4 py-4 text-sm text-fb-text-secondary">
                {disabledMessage}
              </div>
            </Section>
          </PageShell>
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-auto absolute inset-0 z-[620] overflow-y-auto">
      <div className="min-h-full bg-fb-surface-base px-3 pb-8 pt-20 sm:px-6 sm:pt-6">
        <PageShell maxWidth="wide" className="px-0">
          <Stack
            gap={5}
            className="rounded-[24px] border border-fb-border-subtle bg-fb-surface-ghost p-3 shadow-fb-raised sm:p-4"
          >
            <Section compact className="shadow-fb-subtle">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex items-center gap-2">
                  <Clapperboard className="h-5 w-5 text-fb-text-secondary" />
                  <h1 className="text-lg font-semibold text-fb-text-primary">Videoreview</h1>
                </div>
                <p className="text-sm text-fb-text-secondary">Samlet import skjer via import-siden. Her følger du opp videoruter og steg.</p>
              </div>
            </Section>
            {queuedJobs.length === 0 ? (
              <Section title="Ingen aktive videojobber" description="Bruk samlet mediaimport for å få inn nye videoer." className="space-y-3">
                {submitError ? (
                  <p className="rounded-lg border border-[color:var(--fb-accent-danger)]/45 bg-[color:var(--fb-accent-danger)]/8 px-3 py-2 text-sm text-fb-text-primary">
                    {submitError}
                  </p>
                ) : null}
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-fb-border-subtle bg-fb-surface-base p-4">
                  <p className="text-sm text-fb-text-secondary">
                    Når en importmappe inneholder video, havner jobbene her for videre review av rute og steg.
                  </p>
                  {onStartMediaImport ? (
                    <Button type="button" onClick={onStartMediaImport}>
                      Åpne import
                    </Button>
                  ) : null}
                </div>
              </Section>
            ) : (
              <div className="flex items-center gap-2 text-sm text-fb-text-secondary">
                {processingJobCount > 0 ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {processingJobCount > 0 ? `${processingJobCount} jobber prosesserer ...` : "Videoreview klart."}
              </div>
            )}

            <Section title="Jobbstatus" description="Oppdateres automatisk mens jobben kjører." className="space-y-3">
              {queuedJobs.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-fb-text-secondary">
                    <span className="rounded-full border border-fb-border-subtle px-2 py-0.5">
                      {visibleQueuedJobs.length} synlige jobber
                    </span>
                    {archivedJobCount > 0 ? (
                      <span className="rounded-full border border-fb-border-subtle px-2 py-0.5">
                        {archivedJobCount} arkiverte
                      </span>
                    ) : null}
                    {reviewedUnarchivedJobIds.length > 0 && onArchiveReviewedJobs ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          onArchiveReviewedJobs(reviewedUnarchivedJobIds);
                          if (job?.jobId && reviewedUnarchivedJobIds.includes(job.jobId)) {
                            const nextVisibleJob = visibleQueuedJobs.find((entry) => entry.jobId !== job.jobId)?.jobId ?? null;
                            setSelectedJobId(nextVisibleJob);
                          }
                        }}
                      >
                        Arkiver ferdigbehandlede
                      </Button>
                    ) : null}
                    {archivedJobCount > 0 && onRestoreArchivedJobs ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          onRestoreArchivedJobs();
                          setShowArchivedJobs(true);
                        }}
                      >
                        Vis arkiverte
                      </Button>
                    ) : null}
                    {archivedJobCount > 0 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setShowArchivedJobs((current) => !current);
                        }}
                      >
                        {showArchivedJobs ? "Skjul arkiverte" : "Vis arkiverte i køen"}
                      </Button>
                    ) : null}
                  </div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {visibleQueuedJobs.map((entry, index) => {
                    const isActive = entry.jobId === job?.jobId;
                    return (
                      <button
                        key={entry.jobId ?? `queued-${index}`}
                        type="button"
                        className={cn(
                          "min-w-[180px] rounded-xl border px-3 py-2 text-left",
                          isActive
                            ? "border-[color:var(--fb-season-solid)] bg-[color:var(--fb-season-solid)]/10"
                            : "border-fb-border-subtle bg-fb-surface-base",
                        )}
                        onClick={() => {
                          if (entry.jobId) {
                            setSelectedJobId(entry.jobId);
                          }
                        }}
                      >
                        <p className="text-sm font-medium text-fb-text-primary">
                          Jobb {index + 1}{entry.jobId ? ` · ${entry.jobId.slice(0, 8)}` : ""}
                        </p>
                        <p className="text-xs text-fb-text-secondary">
                          {STATUS_UI[entry.status]?.label ?? entry.statusText}
                        </p>
                        <p className="text-[11px] text-fb-text-secondary">
                          {labelReviewState(entry.jobId ? reviewedStateByJobId.get(entry.jobId) ?? null : null)}
                        </p>
                      </button>
                    );
                  })}
                </div>
                </div>
              ) : null}
              {!job ? (
                <p className="text-sm text-fb-text-secondary">Ingen jobb startet ennå.</p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("inline-flex items-center gap-2 rounded-full border px-2 py-0.5 text-xs font-medium", statusUi?.toneClass)}>
                      {job?.status === "pending" || job?.status === "processing" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      {statusUi?.label ?? "Ukjent status"}
                    </span>
                    <span className="text-xs text-fb-text-secondary">
                      Backend-status: <span className="font-medium text-fb-text-primary">{job.statusText}</span>
                    </span>
                  </div>
                  <dl className="grid gap-1 text-sm text-fb-text-primary">
                    <div className="flex flex-wrap gap-x-2">
                      <dt className="text-fb-text-secondary">Jobb-ID:</dt>
                      <dd className="break-all">{job.jobId ?? "Ikke oppgitt av backend"}</dd>
                    </div>
                    <div className="flex flex-wrap gap-x-2">
                      <dt className="text-fb-text-secondary">Sist oppdatert:</dt>
                      <dd>{formatUpdatedAt(job.updatedAt)}</dd>
                    </div>
                    {job.message ? (
                      <div className="flex flex-wrap gap-x-2">
                        <dt className="text-fb-text-secondary">Melding:</dt>
                        <dd>{job.message}</dd>
                      </div>
                    ) : null}
                  </dl>
                </>
              )}
            </Section>

              {job?.status === "done" || job?.status === "failed" ? (
                <Section title="Resultat" description="Resultat fra ferdig videojobb." className="space-y-3">
                  {job?.status === "failed" ? (
                    <p className="rounded-lg border border-[color:var(--fb-accent-danger)]/45 bg-[color:var(--fb-accent-danger)]/8 px-3 py-2 text-sm text-fb-text-primary">
                      {job.message ?? "Videobehandlingen feilet."}
                    </p>
                  ) : null}

                  {framesResult ? (
                    <div className="space-y-3 rounded-xl border border-fb-border-subtle bg-fb-surface-base p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium text-fb-text-primary">Naturlige steg fra video</p>
                          <p className="text-xs text-fb-text-secondary">
                            Videoen deles opp i bildepunkter langs ruten, så du blar i steg i stedet for å spille av video.
                          </p>
                        </div>
                        {framesResult.archive_url ? (
                          <a
                            className="inline-flex text-xs text-fb-text-primary underline decoration-dotted underline-offset-3"
                            href={framesResult.archive_url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Last ned alle bilder
                          </a>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs text-fb-text-secondary">
                        <span className="rounded-full border border-fb-border-subtle px-2 py-0.5">
                          {framesResult.frame_count} bilder trukket ut
                        </span>
                        <span className="rounded-full border border-fb-border-subtle px-2 py-0.5">
                          {framesResult.selected_frame_count} steg valgt
                        </span>
                        <span className="rounded-full border border-fb-border-subtle px-2 py-0.5">
                          {formatDistanceMeters(framesResult.route_distance_m)} løype
                        </span>
                        {framesResult.step_distance_m ? (
                          <span className="rounded-full border border-fb-border-subtle px-2 py-0.5">
                            ca. {formatDistanceMeters(framesResult.step_distance_m)} mellom steg
                          </span>
                        ) : null}
                      </div>

                      {sampleFrames.length > 0 ? (
                        <div className="flex gap-3 overflow-x-auto pb-1">
                          {sampleFrames.map((frame, index) => (
                            <article
                              key={frame.image_url}
                              className="w-[220px] shrink-0 overflow-hidden rounded-xl border border-fb-border-subtle bg-fb-surface-ghost"
                            >
                              <img
                                src={frame.image_url}
                                alt={`Steg ${index + 1}`}
                                className="h-36 w-full object-cover"
                              />
                              <div className="space-y-1 px-3 py-2 text-xs text-fb-text-secondary">
                                <p className="font-medium text-fb-text-primary">Steg {index + 1}</p>
                                <p>Frame #{frame.index}</p>
                                <p>{formatTimestampMs(frame.timestamp_ms)}</p>
                              </div>
                            </article>
                          ))}
                        </div>
                      ) : (
                        <p className="rounded-lg border border-fb-border-subtle bg-fb-surface-ghost px-3 py-2 text-xs text-fb-text-secondary">
                          Ingen steg ble valgt ut for visning ennå.
                        </p>
                      )}
                    </div>
                  ) : null}

                  {showRouteResult ? (
                    <div className="grid gap-3 xl:grid-cols-[1.1fr_0.9fr]">
                      <div className="space-y-2 rounded-xl border border-fb-border-subtle bg-fb-surface-base p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium text-fb-text-primary">Rute i kartet</p>
                          <span className="inline-flex items-center gap-1 rounded-full border border-fb-border-subtle px-2 py-0.5 text-xs text-fb-text-secondary">
                            <MapPin className="h-3.5 w-3.5" />
                            {formatPlacement(routeStats?.startPoint ?? null)}
                          </span>
                        </div>
                        <VideoRouteMap
                          geodataUrl={routeResult?.geodata_geojson ?? ""}
                          baseMapStyle={baseMapStyle}
                          showZoomControls={showZoomControls}
                          onRouteStatsChange={(nextStats) => {
                            setRouteStats(
                              nextStats == null
                                ? null
                                : {
                                    segmentCount: nextStats.segmentCount,
                                    pointCount: nextStats.pointCount,
                                    startPoint: toPlacementFromLatLng(nextStats.startPoint),
                                    endPoint: toPlacementFromLatLng(nextStats.endPoint),
                                  },
                            );
                          }}
                        />
                      </div>

                      <div className="space-y-3 rounded-xl border border-fb-border-subtle bg-fb-surface-base p-3">
                        <div className="space-y-1">
                          <p className="text-sm font-medium text-fb-text-primary">Slik vises dette i hovedkartet</p>
                          <p className="text-xs text-fb-text-secondary">
                            Sporet vises som en prikk i startpunktet. Når du holder pekeren over den i kartet, vises hele ruten og sluttpunktet.
                          </p>
                        </div>
                        <div className="grid gap-1 text-xs text-fb-text-secondary">
                          <p>
                            <span className="text-fb-text-primary">Rute:</span> {formatRouteStats(routeStats)}
                          </p>
                          {routeStats?.startPoint ? (
                            <p>
                              <span className="text-fb-text-primary">Start:</span> {formatPlacement(routeStats.startPoint)}
                            </p>
                          ) : null}
                          {routeStats?.endPoint ? (
                            <p>
                              <span className="text-fb-text-primary">Slutt:</span> {formatPlacement(routeStats.endPoint)}
                            </p>
                          ) : null}
                          <p>
                            <span className="text-fb-text-primary">Kartstil:</span> {mapStyleLabel}
                          </p>
                          {routeResult?.geodata_geojson ? (
                            <a
                              className="inline-flex text-xs text-fb-text-primary underline decoration-dotted underline-offset-3"
                              href={routeResult.geodata_geojson}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Vis geodata
                            </a>
                          ) : null}
                        </div>

                        {onVideoReview && isReadyForReview ? (
                          <div className="flex flex-wrap gap-2">
                            {currentReviewState === "placed" || reviewDecision === "place_on_map" ? (
                              <p className="rounded-lg border border-[color:var(--fb-accent-success)]/35 bg-[color:var(--fb-accent-success)]/10 px-3 py-2 text-sm text-fb-text-primary">
                                Videoløypa ligger nå i kartet som startprikk med hover-rute.
                              </p>
                            ) : (
                              <Button type="button" onClick={() => void handleAddRouteToMap()} disabled={!canPlaceRoute || isReviewSubmitting}>
                                Legg videospor i kart
                              </Button>
                            )}
                            {currentReviewState && !currentJobArchived && onArchiveJob ? (
                              <Button type="button" variant="outline" onClick={handleArchiveCurrentJob}>
                                Arkiver denne
                              </Button>
                            ) : null}
                            {nextUnreviewedJobId ? (
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => {
                                  setSelectedJobId(nextUnreviewedJobId);
                                }}
                              >
                                Neste ubehandlede jobb
                              </Button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <p className="rounded-lg border border-fb-border-subtle bg-fb-surface-base px-3 py-2 text-sm text-fb-text-secondary">
                      Rutedata er ikke klare ennå.
                    </p>
                  )}

                  <div className="space-y-2 rounded-xl border border-fb-border-subtle bg-fb-surface-base p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-fb-text-primary">Metadata og teknisk resultat</p>
                      {routeResult?.metadata_json ? (
                        <a
                          className="inline-flex text-xs text-fb-text-primary underline decoration-dotted underline-offset-3"
                          href={routeResult.metadata_json}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Last ned metadata (.json)
                        </a>
                      ) : null}
                    </div>
                    {metadataLoading ? (
                      <p className="text-xs text-fb-text-secondary">Laster metadata ...</p>
                    ) : metadataError ? (
                      <p className="text-xs text-fb-text-secondary">
                        Metadata ikke tilgjengelig ({metadataError}). Viser ellers rute og bilder.
                      </p>
                    ) : metadataRows.length > 0 ? (
                      <details className="rounded-lg border border-fb-border-subtle bg-fb-surface-ghost px-3 py-2">
                        <summary className="cursor-pointer text-xs text-fb-text-primary">
                          Vis metadatafelter ({metadataRows.length})
                        </summary>
                        <dl className="mt-2 grid gap-1 text-xs text-fb-text-primary">
                          {metadataRows.slice(0, 120).map((row) => (
                            <div key={row.key} className="flex flex-wrap gap-x-2 gap-y-1">
                              <dt className="min-w-52 max-w-full shrink-0 text-fb-text-secondary">{row.key}</dt>
                              <dd className="break-all text-fb-text-primary">{row.value}</dd>
                            </div>
                          ))}
                        </dl>
                      </details>
                    ) : (
                      <p className="text-xs text-fb-text-secondary">Ingen metadata registrert.</p>
                    )}

                    {resultJson ? (
                      <details className="rounded-lg border border-fb-border-subtle bg-fb-surface-ghost px-3 py-2">
                        <summary className="cursor-pointer text-xs text-fb-text-primary">Vis teknisk JSON</summary>
                        <pre className="mt-2 max-h-72 overflow-auto text-xs text-fb-text-primary">{resultJson}</pre>
                      </details>
                    ) : (
                      <p className="text-xs text-fb-text-secondary">
                        Jobben er ferdig, men backend returnerte ikke resultatsammendrag.
                      </p>
                    )}
                  </div>

                </Section>
              ) : null}
          </Stack>
        </PageShell>
      </div>
    </div>
  );
}
