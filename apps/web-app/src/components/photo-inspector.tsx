import { type Dispatch, type SetStateAction } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, ImageOff, Pencil, RefreshCw } from "lucide-react";

import {
  formatCapturedAt,
  formatConfidence,
  formatCoordinate,
  formatGeometryMethod,
  formatGsd,
  formatMeters,
  formatPercent,
  formatQCRating,
  getAnalysisToneText,
  normalizeTagsInput,
  type ManualViewTarget,
} from "@/lib/formatters";
import { type BaseMapStyle } from "@/lib/map-styles";
import { photoIdKey } from "@/lib/photo-ordering";
import { PhotoMapInset } from "@/components/photo-map-inset";
import { Button } from "@/components/ui/button";
import { CloseButton } from "@/components/ui/close-button";
import type { PhotoFeature } from "@/types";

type PhotoAnalysisAction = "approve" | "recompute";

interface PhotoInspectorProps {
  open: boolean;
  selectedPhoto: PhotoFeature | null;
  selectedPhotoId: string | null;
  selectedPhotoImageUrl: string | null;
  selectedPhotoManualViewTarget: ManualViewTarget | null;
  stripPhotos: PhotoFeature[];
  hasPrevPhoto: boolean;
  hasNextPhoto: boolean;
  baseMapStyle: BaseMapStyle;
  metadataEditMode: boolean;
  showTechnicalMetadata: boolean;
  metadataBusyPhotoId: string | null;
  analysisBusyPhotoId: string | null;
  isAdminAuthenticated: boolean;
  metadataTagDraft: string;
  metadataTagsDraft: string[];
  metadataCaptionDraft: string;
  metadataNeedsManualQcDraft: boolean;
  metadataAltitudeDraft: string;
  metadataHeadingDraft: string;
  metadataPitchDraft: string;
  metadataManualViewTargetDraft: ManualViewTarget | null;
  activeInsetManualTarget: ManualViewTarget | null;
  hasMetadataChanges: boolean;
  onClose: () => void;
  onSelectPhoto: (photoId: string) => void;
  onStepPhoto: (direction: -1 | 1) => void;
  onSetMetadataEditMode: Dispatch<SetStateAction<boolean>>;
  onSetShowTechnicalMetadata: Dispatch<SetStateAction<boolean>>;
  onSetMetadataTagDraft: Dispatch<SetStateAction<string>>;
  onSetMetadataTagsDraft: Dispatch<SetStateAction<string[]>>;
  onSetMetadataCaptionDraft: Dispatch<SetStateAction<string>>;
  onSetMetadataNeedsManualQcDraft: Dispatch<SetStateAction<boolean>>;
  onSetMetadataAltitudeDraft: Dispatch<SetStateAction<string>>;
  onSetMetadataHeadingDraft: Dispatch<SetStateAction<string>>;
  onSetMetadataPitchDraft: Dispatch<SetStateAction<string>>;
  onSetMetadataManualViewTargetDraft: Dispatch<SetStateAction<ManualViewTarget | null>>;
  onPhotoAnalysisAction: (photoId: string, action: PhotoAnalysisAction) => Promise<void> | void;
  onCancelMetadataEdit: () => void;
  onSavePhotoMetadata: () => Promise<void> | void;
}

interface PhotoStripProps {
  photos: PhotoFeature[];
  activePhotoId: string | null;
  hasPrevPhoto: boolean;
  hasNextPhoto: boolean;
  onSelectPhoto: (photoId: string) => void;
  onStepPhoto: (direction: -1 | 1) => void;
}

function PhotoStrip({
  photos,
  activePhotoId,
  hasPrevPhoto,
  hasNextPhoto,
  onSelectPhoto,
  onStepPhoto,
}: PhotoStripProps) {
  return (
    <div className="photo-viewer-strip-wrap">
      <div className="photo-viewer-strip">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="photo-viewer-strip-nav"
          onClick={() => onStepPhoto(-1)}
          disabled={!hasPrevPhoto}
          aria-label="Forrige bilde"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        <div className="photo-viewer-strip-list">
          {photos.map((photo) => {
            const active = photoIdKey(photo.id) === photoIdKey(activePhotoId);
            const thumb = photo.thumbnail_url || photo.image_url || "";
            return (
              <button
                key={photo.id}
                type="button"
                className={`photo-viewer-strip-item ${active ? "is-active" : ""}`}
                onClick={() => onSelectPhoto(photo.id)}
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
          onClick={() => onStepPhoto(1)}
          disabled={!hasNextPhoto}
          aria-label="Neste bilde"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export function PhotoInspector({
  open,
  selectedPhoto,
  selectedPhotoId,
  selectedPhotoImageUrl,
  selectedPhotoManualViewTarget,
  stripPhotos,
  hasPrevPhoto,
  hasNextPhoto,
  baseMapStyle,
  metadataEditMode,
  showTechnicalMetadata,
  metadataBusyPhotoId,
  analysisBusyPhotoId,
  isAdminAuthenticated,
  metadataTagDraft,
  metadataTagsDraft,
  metadataCaptionDraft,
  metadataNeedsManualQcDraft,
  metadataAltitudeDraft,
  metadataHeadingDraft,
  metadataPitchDraft,
  metadataManualViewTargetDraft,
  activeInsetManualTarget,
  hasMetadataChanges,
  onClose,
  onSelectPhoto,
  onStepPhoto,
  onSetMetadataEditMode,
  onSetShowTechnicalMetadata,
  onSetMetadataTagDraft,
  onSetMetadataTagsDraft,
  onSetMetadataCaptionDraft,
  onSetMetadataNeedsManualQcDraft,
  onSetMetadataAltitudeDraft,
  onSetMetadataHeadingDraft,
  onSetMetadataPitchDraft,
  onSetMetadataManualViewTargetDraft,
  onPhotoAnalysisAction,
  onCancelMetadataEdit,
  onSavePhotoMetadata,
}: PhotoInspectorProps) {
  if (!open) return null;

  const strip = (
    <PhotoStrip
      photos={stripPhotos}
      activePhotoId={selectedPhoto?.id ?? selectedPhotoId}
      hasPrevPhoto={hasPrevPhoto}
      hasNextPhoto={hasNextPhoto}
      onSelectPhoto={onSelectPhoto}
      onStepPhoto={onStepPhoto}
    />
  );

  return (
    <div
      className="photo-viewer-overlay fixed inset-0 z-[1300]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="photo-viewer-shell h-full w-full p-2 sm:p-4">
        <div className="photo-viewer-stage pointer-events-auto h-full w-full overflow-hidden rounded-[22px] border border-fb-border-subtle/45">
          <div className="photo-viewer-layout h-full">
            {selectedPhoto ? (
              <>
                <div className="photo-viewer-image-pane relative">
                  {selectedPhotoImageUrl ? (
                    <>
                      <img
                        src={selectedPhotoImageUrl}
                        alt=""
                        aria-hidden="true"
                        className="photo-viewer-backdrop pointer-events-none absolute inset-0 h-full w-full object-cover"
                      />

                      <div className="photo-viewer-image-wrap relative h-full w-full">
                        <img
                          src={selectedPhotoImageUrl}
                          alt={selectedPhoto.title || "Foto"}
                          className="photo-viewer-image h-full w-full cursor-zoom-out object-contain"
                          onClick={onClose}
                          title="Trykk for å lukke fullskjerm"
                        />
                      </div>
                    </>
                  ) : (
                    <div className="photo-viewer-image-wrap relative flex h-full w-full items-center justify-center bg-fb-surface-ghost text-center text-fb-text-secondary">
                      <div className="max-w-xs px-6">
                        <ImageOff className="mx-auto mb-3 h-9 w-9 text-fb-text-muted" />
                        <p className="text-sm font-medium text-fb-text-primary">Bildefilen mangler</p>
                        <p className="mt-1 text-xs leading-5">
                          Metadata finnes, men hverken originalbilde eller miniatyr er tilgjengelig i API-svaret.
                        </p>
                      </div>
                    </div>
                  )}

                  {strip}
                </div>

                <aside className="photo-viewer-meta-column">
                  <div className="photo-viewer-meta-header">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 pr-1">
                        <p className="text-[11px] uppercase tracking-[0.08em] text-fb-text-secondary">Foto</p>
                        <h2 className="text-base font-semibold text-fb-text-primary">{selectedPhoto.title || "Foto"}</h2>
                      </div>
                      <div className="photo-viewer-meta-actions">
                        <Button
                          variant={metadataEditMode ? "default" : "ghost"}
                          size="icon"
                          className="h-9 w-9 shrink-0 rounded-full border border-fb-border-subtle bg-fb-surface-ghost text-fb-text-primary hover:bg-fb-surface-base"
                          onClick={() => onSetMetadataEditMode((value) => !value)}
                          aria-label={metadataEditMode ? "Avslutt redigering" : "Rediger metadata"}
                          aria-pressed={metadataEditMode}
                          disabled={!isAdminAuthenticated}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <CloseButton onClick={onClose} label="Lukk bildevisning" />
                      </div>
                    </div>
                  </div>

                  <div className="photo-viewer-meta-body">
                    <div className="space-y-2.5">
                      <div className="rounded-xl border border-fb-border-subtle bg-fb-surface-ghost p-2 text-fb-text-primary">
                        <p className="text-[11px] uppercase tracking-[0.08em] text-fb-text-muted">Analyse</p>
                        <dl className="mt-2 grid gap-1.5 text-xs text-fb-text-primary">
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
                            onClick={() => void onPhotoAnalysisAction(selectedPhoto.id, "approve")}
                            disabled={
                              analysisBusyPhotoId === selectedPhoto.id ||
                              !isAdminAuthenticated ||
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
                            onClick={() => void onPhotoAnalysisAction(selectedPhoto.id, "recompute")}
                            disabled={analysisBusyPhotoId === selectedPhoto.id || !isAdminAuthenticated}
                            className="h-8"
                          >
                            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                            {selectedPhoto.analysis ? "Reberegn" : "Beregn nå"}
                          </Button>
                        </div>
                      </div>

                      <div className="rounded-xl border border-fb-border-subtle bg-fb-surface-ghost p-2 text-fb-text-primary">
                        <p className="text-[11px] uppercase tracking-[0.08em] text-fb-text-secondary">Nøkkelinformasjon</p>
                        <dl className="mt-2 grid gap-1.5 text-xs text-fb-text-primary">
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

                      <div className="rounded-xl border border-fb-border-subtle bg-fb-surface-ghost p-2 text-fb-text-primary">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[11px] uppercase tracking-[0.08em] text-fb-text-secondary">Metadata</p>
                          <span className="rounded-full border border-fb-border-subtle bg-fb-surface-ghost px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-fb-text-secondary">
                            {metadataEditMode ? "Redigering" : "Lesemodus"}
                          </span>
                        </div>

                        <dl className="mt-2 grid gap-2 text-xs text-fb-text-primary">
                          <div className="flex items-center justify-between gap-2">
                            <dt>Høyde (m)</dt>
                            <dd className="w-28">
                              {metadataEditMode ? (
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  className="h-8 w-full rounded-lg border border-fb-border-subtle bg-fb-surface-ghost px-2 text-right text-xs text-fb-text-primary outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--fb-focus-ring)]"
                                  value={metadataAltitudeDraft}
                                  placeholder="ukjent"
                                  onChange={(event) => onSetMetadataAltitudeDraft(event.target.value)}
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
                                  className="h-8 w-full rounded-lg border border-fb-border-subtle bg-fb-surface-ghost px-2 text-right text-xs text-fb-text-primary outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--fb-focus-ring)]"
                                  value={metadataHeadingDraft}
                                  placeholder="ukjent"
                                  onChange={(event) => onSetMetadataHeadingDraft(event.target.value)}
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
                                  className="h-8 w-full rounded-lg border border-fb-border-subtle bg-fb-surface-ghost px-2 text-right text-xs text-fb-text-primary outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--fb-focus-ring)]"
                                  value={metadataPitchDraft}
                                  placeholder="ukjent"
                                  onChange={(event) => onSetMetadataPitchDraft(event.target.value)}
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
                                <label className="inline-flex items-center gap-2 text-xs text-fb-text-primary">
                                  <input
                                    type="checkbox"
                                    checked={metadataNeedsManualQcDraft}
                                    onChange={(event) => {
                                      onSetMetadataNeedsManualQcDraft(event.currentTarget.checked);
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
                                  <p className="text-[11px] text-fb-text-secondary">Klikk i kartet eller dra punktet</p>
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
                                      onClick={() => onSetMetadataManualViewTargetDraft(null)}
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
                          <p className="text-[11px] uppercase tracking-[0.08em] text-fb-text-secondary">Tags</p>
                          <div className="flex flex-wrap gap-1.5">
                            {metadataTagsDraft.length > 0 ? (
                              metadataTagsDraft.map((tag) => (
                                <span
                                  key={tag}
                                  className="inline-flex items-center gap-1 rounded-full border border-fb-border-subtle bg-fb-surface-ghost px-2.5 py-1 text-xs text-fb-text-primary"
                                >
                                  {tag}
                                  {metadataEditMode ? (
                                    <button
                                      type="button"
                                      className="rounded text-fb-text-secondary hover:text-fb-text-primary"
                                      aria-label={`Fjern tag ${tag}`}
                                      onClick={() =>
                                        onSetMetadataTagsDraft((previous) =>
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
                              <span className="text-xs text-fb-text-secondary">Ingen tags ennå</span>
                            )}
                          </div>
                          {metadataEditMode ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                className="h-8 flex-1 rounded-lg border border-fb-border-subtle bg-fb-surface-ghost px-2 text-xs text-fb-text-primary outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--fb-focus-ring)]"
                                placeholder="Ny tag"
                                value={metadataTagDraft}
                                onChange={(event) => onSetMetadataTagDraft(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key !== "Enter") return;
                                  event.preventDefault();
                                  const nextTag = metadataTagDraft.trim();
                                  if (!nextTag) return;
                                  onSetMetadataTagsDraft((previous) => normalizeTagsInput([...previous, nextTag]));
                                  onSetMetadataTagDraft("");
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
                                  onSetMetadataTagsDraft((previous) => normalizeTagsInput([...previous, nextTag]));
                                  onSetMetadataTagDraft("");
                                }}
                                disabled={!metadataTagDraft.trim() || metadataBusyPhotoId === selectedPhoto.id}
                              >
                                Legg til
                              </Button>
                            </div>
                          ) : null}
                        </div>

                        <div className="mt-2 space-y-2">
                          <p className="text-[11px] uppercase tracking-[0.08em] text-fb-text-secondary">Notat</p>
                          {metadataEditMode ? (
                            <textarea
                              className="min-h-[72px] w-full rounded-xl border border-fb-border-subtle bg-fb-surface-ghost p-2 text-sm text-fb-text-primary outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--fb-focus-ring)]"
                              value={metadataCaptionDraft}
                              placeholder="Skriv notat ..."
                              onChange={(event) => onSetMetadataCaptionDraft(event.target.value)}
                              disabled={metadataBusyPhotoId === selectedPhoto.id}
                            />
                          ) : (
                            <p className="rounded-lg border border-fb-border-subtle bg-fb-surface-ghost p-2 text-xs text-fb-text-primary">
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
                              onClick={onCancelMetadataEdit}
                              disabled={metadataBusyPhotoId === selectedPhoto.id}
                            >
                              Avbryt
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="default"
                              className="h-8"
                              onClick={() => void onSavePhotoMetadata()}
                              disabled={!hasMetadataChanges || metadataBusyPhotoId === selectedPhoto.id || !isAdminAuthenticated}
                            >
                              Lagre metadata
                            </Button>
                          </div>
                        ) : null}
                      </div>

                      <div className="rounded-xl border border-fb-border-subtle bg-fb-surface-ghost p-2 text-fb-text-primary">
                        <p className="text-[11px] uppercase tracking-[0.08em] text-fb-text-secondary">Kartutsnitt</p>
                        <div className="mt-1">
                          <PhotoMapInset
                            photo={selectedPhoto}
                            baseMapStyle={baseMapStyle}
                            editable={metadataEditMode}
                            manualTarget={activeInsetManualTarget}
                            onManualTargetChange={onSetMetadataManualViewTargetDraft}
                          />
                        </div>
                      </div>

                      <div className="rounded-xl border border-fb-border-subtle bg-fb-surface-ghost p-2 text-fb-text-primary">
                        <button
                          type="button"
                          className="flex w-full items-center justify-between text-left"
                          onClick={() => onSetShowTechnicalMetadata((value) => !value)}
                        >
                          <span className="text-[11px] uppercase tracking-[0.08em] text-fb-text-secondary">Teknisk metadata</span>
                          <span className="text-[11px] text-fb-text-primary">{showTechnicalMetadata ? "Skjul" : "Vis"}</span>
                        </button>
                        {showTechnicalMetadata ? (
                          <dl className="mt-2 grid gap-1.5 text-xs text-fb-text-primary">
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
                  </div>
                </aside>
              </>
            ) : (
              <>
                <div className="photo-viewer-image-pane relative">
                  {strip}

                  <div className="photo-viewer-image-wrap relative flex h-full w-full items-center justify-center text-center">
                    <div>
                      <p className="mb-2 text-sm text-fb-text-primary/80">Finner valgt bilde ...</p>
                      <p className="text-xs text-fb-text-primary/70">
                        Photo-ID: <span className="font-mono">{selectedPhotoId ?? "ukjent"}</span>
                      </p>
                    </div>
                  </div>
                </div>

                <aside className="photo-viewer-meta-column">
                  <div className="photo-viewer-meta-header">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 pr-1">
                        <p className="text-[11px] uppercase tracking-[0.08em] text-fb-text-secondary">Foto</p>
                        <h2 className="text-base font-semibold text-fb-text-primary">Laster metadata ...</h2>
                      </div>
                      <div className="photo-viewer-meta-actions">
                        <CloseButton onClick={onClose} label="Lukk bildevisning" />
                      </div>
                    </div>
                  </div>
                  <div className="photo-viewer-meta-body" />
                </aside>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
