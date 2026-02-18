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
