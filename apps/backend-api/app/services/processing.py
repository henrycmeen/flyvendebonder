from __future__ import annotations

import json
from datetime import datetime

from ..models import FlightCapture, Photo, ProcessingArtifact, ProcessingRun

SUPPORTED_PROCESSING_PROVIDERS = ("webodm", "odm_cli")
DEFAULT_PROCESSING_PROVIDER = "webodm"


def processing_provider_profile(provider: str) -> dict:
    if provider == "webodm":
        return {
            "api_mode": "poll",
            "adapter": "nodeodm-compatible",
            "recommended_for": ["first_integration", "local_docker", "job_tracking"],
        }
    if provider == "odm_cli":
        return {
            "api_mode": "process",
            "adapter": "native_cli",
            "recommended_for": ["advanced_tuning", "direct_host_control"],
        }
    raise ValueError(f"Ukjent processing-provider: {provider}")


def build_capture_summary(photos: list[Photo]) -> tuple[datetime | None, datetime | None]:
    if not photos:
        return None, None
    ordered = sorted(photos, key=lambda item: (item.captured_at, item.id))
    return ordered[0].captured_at, ordered[-1].captured_at


def build_capture_photo_summary(photos: list[Photo]) -> dict:
    ordered = sorted(photos, key=lambda item: (item.captured_at, item.id))
    if not ordered:
        return {
            "first_photo_id": None,
            "last_photo_id": None,
            "is_contiguous": True,
        }
    return {
        "first_photo_id": ordered[0].id,
        "last_photo_id": ordered[-1].id,
        "is_contiguous": [item.id for item in ordered] == [item.id for item in photos],
    }


def build_processing_input_manifest(
    *,
    capture: FlightCapture,
    provider: str,
    requested_outputs: list[str],
    provider_config: dict,
) -> dict:
    return {
        "provider": provider,
        "provider_profile": processing_provider_profile(provider),
        "capture_id": capture.id,
        "user_id": capture.user_id,
        "property_id": capture.property_id,
        "mission_id": capture.mission_id,
        "photo_ids": json.loads(capture.photo_ids_json),
        "photo_count": capture.photo_count,
        "field_ids": json.loads(capture.field_ids_json),
        "captured_from": capture.captured_from.isoformat() if capture.captured_from else None,
        "captured_to": capture.captured_to.isoformat() if capture.captured_to else None,
        "requested_outputs": requested_outputs,
        "provider_config": provider_config,
    }


def processing_run_should_start(status: str, started_at: datetime | None) -> datetime | None:
    if status in {"running", "completed", "failed", "cancelled"} and started_at is None:
        return datetime.utcnow()
    return started_at


def processing_run_should_finish(status: str, finished_at: datetime | None) -> datetime | None:
    if status in {"completed", "failed", "cancelled"}:
        return finished_at or datetime.utcnow()
    return None


def artifact_public_url(artifact: ProcessingArtifact) -> str | None:
    if artifact.is_public:
        return artifact.uri
    return None
