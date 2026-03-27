from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from sqlalchemy import (
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Boolean,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    phone: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    address_line1: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    postal_code: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    city: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    municipality_code: Mapped[Optional[str]] = mapped_column(String(8), nullable=True)
    municipality_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)

    properties: Mapped[list[Property]] = relationship(back_populates="user", cascade="all, delete-orphan")
    photos: Mapped[list[Photo]] = relationship(back_populates="user", cascade="all, delete-orphan")
    flight_captures: Mapped[list[FlightCapture]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class Property(TimestampMixin, Base):
    __tablename__ = "properties"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)

    komm: Mapped[str] = mapped_column(String(8), nullable=False)
    gnr: Mapped[int] = mapped_column(Integer, nullable=False)
    bnr: Mapped[int] = mapped_column(Integer, nullable=False)
    fnr: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    label: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    active_from: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    active_to: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    user: Mapped[User] = relationship(back_populates="properties")
    photos: Mapped[list[Photo]] = relationship(back_populates="property")
    job_cache: Mapped[list[GardskartJobCache]] = relationship(back_populates="property")
    field_plots: Mapped[list[FieldPlot]] = relationship(back_populates="property", cascade="all, delete-orphan")
    flight_missions: Mapped[list[FlightMission]] = relationship(
        back_populates="property", cascade="all, delete-orphan"
    )
    flight_captures: Mapped[list[FlightCapture]] = relationship(
        back_populates="property", cascade="all, delete-orphan"
    )

    __table_args__ = (
        UniqueConstraint("user_id", "komm", "gnr", "bnr", "fnr", name="uq_property_owner"),
    )


class Photo(TimestampMixin, Base):
    __tablename__ = "photos"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    property_id: Mapped[Optional[int]] = mapped_column(ForeignKey("properties.id", ondelete="SET NULL"), index=True)

    captured_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    captured_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)

    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lng: Mapped[float] = mapped_column(Float, nullable=False)
    altitude_m: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    heading_deg: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    pitch_deg: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    gsd_m: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    image_footprint_w_m: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    track_spacing_m: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    overlap_front: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    overlap_side: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    oblique_correction_applied: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)

    source_filename: Mapped[str] = mapped_column(String(512), nullable=False)
    source_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    tags_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")

    user: Mapped[User] = relationship(back_populates="photos")
    property: Mapped[Optional[Property]] = relationship(back_populates="photos")
    analysis: Mapped["PhotoAnalysis"] = relationship(back_populates="photo", uselist=False, cascade="all, delete-orphan")
    assets: Mapped[list[PhotoAsset]] = relationship(back_populates="photo", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_photo_secondary_dedupe", "source_filename", "captured_at", "lat", "lng"),
        Index("idx_photos_user_captured_at_id", "user_id", "captured_at", "id"),
    )


class FieldPlot(TimestampMixin, Base):
    __tablename__ = "field_plots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    property_id: Mapped[int] = mapped_column(ForeignKey("properties.id", ondelete="CASCADE"), index=True)

    name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    source: Mapped[str] = mapped_column(String(24), nullable=False, default="manual")
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="draft")
    geometry_json: Mapped[str] = mapped_column(Text, nullable=False)
    area_m2: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    property: Mapped[Property] = relationship(back_populates="field_plots")


class FlightMission(TimestampMixin, Base):
    __tablename__ = "flight_missions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    property_id: Mapped[int] = mapped_column(ForeignKey("properties.id", ondelete="CASCADE"), index=True)

    name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="ready")
    field_ids_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    parameters_json: Mapped[str] = mapped_column(Text, nullable=False)
    field_snapshots_json: Mapped[str] = mapped_column(Text, nullable=False)
    route_geojson_json: Mapped[str] = mapped_column(Text, nullable=False)
    warnings_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    export_manifest_json: Mapped[str] = mapped_column(Text, nullable=False)
    last_generated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)

    property: Mapped[Property] = relationship(back_populates="flight_missions")
    flight_captures: Mapped[list[FlightCapture]] = relationship(back_populates="mission")


class FlightCapture(TimestampMixin, Base):
    __tablename__ = "flight_captures"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    property_id: Mapped[int] = mapped_column(ForeignKey("properties.id", ondelete="CASCADE"), index=True)
    mission_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("flight_missions.id", ondelete="SET NULL"), index=True, nullable=True
    )

    name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    source: Mapped[str] = mapped_column(String(24), nullable=False, default="manual")
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="ready")
    photo_ids_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    photo_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    field_ids_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    captured_from: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    captured_to: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    user: Mapped[User] = relationship(back_populates="flight_captures")
    property: Mapped[Property] = relationship(back_populates="flight_captures")
    mission: Mapped[Optional[FlightMission]] = relationship(back_populates="flight_captures")
    processing_runs: Mapped[list[ProcessingRun]] = relationship(
        back_populates="capture", cascade="all, delete-orphan"
    )


class ProcessingRun(TimestampMixin, Base):
    __tablename__ = "processing_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    capture_id: Mapped[int] = mapped_column(ForeignKey("flight_captures.id", ondelete="CASCADE"), index=True)

    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="queued")
    external_job_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    requested_outputs_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    provider_config_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    input_manifest_json: Mapped[str] = mapped_column(Text, nullable=False)
    error_detail: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    last_synced_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    capture: Mapped[FlightCapture] = relationship(back_populates="processing_runs")
    artifacts: Mapped[list[ProcessingArtifact]] = relationship(
        back_populates="processing_run", cascade="all, delete-orphan"
    )


class ProcessingArtifact(TimestampMixin, Base):
    __tablename__ = "processing_artifacts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    processing_run_id: Mapped[int] = mapped_column(
        ForeignKey("processing_runs.id", ondelete="CASCADE"), index=True
    )

    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    format: Mapped[str] = mapped_column(String(32), nullable=False)
    uri: Mapped[str] = mapped_column(String(1024), nullable=False)
    bytes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    checksum: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    is_public: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    metadata_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")

    processing_run: Mapped[ProcessingRun] = relationship(back_populates="artifacts")


class PhotoAsset(Base):
    __tablename__ = "photo_assets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    photo_id: Mapped[str] = mapped_column(ForeignKey("photos.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)

    path: Mapped[str] = mapped_column(String(1024), nullable=False)
    mime: Mapped[str] = mapped_column(String(128), nullable=False)
    bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    width: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    height: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    photo: Mapped[Photo] = relationship(back_populates="assets")

    __table_args__ = (UniqueConstraint("photo_id", "kind", name="uq_photo_asset_kind"),)


class PhotoAnalysis(Base):
    __tablename__ = "photo_analysis"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    photo_id: Mapped[str] = mapped_column(ForeignKey("photos.id", ondelete="CASCADE"), index=True, unique=True)

    ar5_class: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    soil_class: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    geometry_method: Mapped[Optional[str]] = mapped_column(String(24), nullable=True)
    confidence: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    approved: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    computed_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)

    photo: Mapped[Photo] = relationship(back_populates="analysis")


class GardskartJobCache(Base):
    __tablename__ = "gardskart_job_cache"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    property_id: Mapped[int] = mapped_column(ForeignKey("properties.id", ondelete="CASCADE"), index=True)

    job_id: Mapped[str] = mapped_column(String(128), nullable=False)
    status_code: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    status_desc: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    fetched_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    last_validated_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    property: Mapped[Property] = relationship(back_populates="job_cache")


class IngestRun(Base):
    __tablename__ = "ingest_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    started_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    source_path: Mapped[str] = mapped_column(String(2048), nullable=False)

    files_seen: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    files_imported: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    files_skipped: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    errors_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
