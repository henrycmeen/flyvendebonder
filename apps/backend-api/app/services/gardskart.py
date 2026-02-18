from __future__ import annotations

import logging
from datetime import datetime, timedelta

import httpx
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import GardskartJobCache, Property

logger = logging.getLogger(__name__)
settings = get_settings()


async def _fetch_job_from_nibio(property_obj: Property) -> tuple[str, int | None, str | None]:
    params = {
        "komm": property_obj.komm,
        "gnr": str(property_obj.gnr),
        "bnr": str(property_obj.bnr),
        "fnr": str(property_obj.fnr),
    }

    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(settings.nibio_gpiareastat_url, params=params)

    response.raise_for_status()
    payload = response.json()
    job_id = payload.get("jobId")
    if not job_id:
        raise ValueError("Mangler jobId i svar fra NIBIO gpiareastat")

    confirmation = payload.get("nonfarmPropertyConfirmation") or {}
    status_code = confirmation.get("dekWFSStatusCode")
    status_desc = confirmation.get("dekWFSStatusDesc")
    return str(job_id), status_code, status_desc


def _current_cache(db: Session, property_id: int) -> GardskartJobCache | None:
    return db.execute(
        select(GardskartJobCache)
        .where(GardskartJobCache.property_id == property_id)
        .order_by(desc(GardskartJobCache.fetched_at))
        .limit(1)
    ).scalar_one_or_none()


async def get_job_id(db: Session, property_obj: Property, force_refresh: bool = False) -> tuple[GardskartJobCache, str]:
    now = datetime.utcnow()
    current = _current_cache(db, property_obj.id)

    if current and current.expires_at > now and not force_refresh:
        current.last_validated_at = now
        db.commit()
        db.refresh(current)
        return current, "cache"

    try:
        job_id, status_code, status_desc = await _fetch_job_from_nibio(property_obj)
        cache = GardskartJobCache(
            property_id=property_obj.id,
            job_id=job_id,
            status_code=status_code,
            status_desc=status_desc,
            fetched_at=now,
            expires_at=now + timedelta(hours=settings.nibio_job_ttl_hours),
            last_validated_at=now,
        )
        db.add(cache)
        db.commit()
        db.refresh(cache)

        logger.info(
            "Fetched fresh Gardskart jobId",
            extra={
                "property": f"{property_obj.komm}-{property_obj.gnr}/{property_obj.bnr}/{property_obj.fnr}",
                "job_id": job_id,
                "status_code": status_code,
            },
        )

        return cache, "fresh"
    except Exception as exc:  # noqa: BLE001
        logger.exception("Failed to refresh Gardskart jobId", extra={"error": str(exc)})

        if current is not None:
            current.last_validated_at = now
            db.commit()
            db.refresh(current)
            return current, "stale-cache"

        raise
