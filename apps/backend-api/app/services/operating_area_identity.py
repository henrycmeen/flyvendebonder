from __future__ import annotations

import hashlib
import json
from typing import Any

from ..models import Property


def candidate_source_key(candidate: dict[str, Any]) -> str:
    property_ref = candidate.get("property_ref")
    if not isinstance(property_ref, dict):
        raise ValueError("Kandidaten mangler matrikkeldata")
    local_id = candidate.get("local_id")
    source_feature = (
        {"local_id": local_id}
        if local_id is not None
        else {
            "matrikkelnummer": candidate.get("matrikkelnummer"),
            "object_type": candidate.get("object_type"),
            "is_main_area": bool(candidate.get("is_main_area")),
            "name": candidate.get("name"),
            # Geonorge has no stable identity in this branch. Geometry avoids
            # collapsing two distinct sub-parcels into one persisted field.
            "geometry": candidate.get("geometry"),
        }
    )
    identity = {
        "source": candidate.get("source"),
        "komm": str(property_ref.get("komm") or "").strip(),
        "gnr": property_ref.get("gnr"),
        "bnr": property_ref.get("bnr"),
        "fnr": property_ref.get("fnr") or 0,
        "source_feature": source_feature,
    }
    if (
        not identity["source"]
        or not identity["komm"]
        or identity["gnr"] is None
        or identity["bnr"] is None
    ):
        raise ValueError("Kandidaten mangler gyldig identitet")
    encoded = json.dumps(identity, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def candidate_id(candidate: dict[str, Any]) -> str:
    geometry = candidate.get("geometry")
    if not isinstance(geometry, dict):
        raise ValueError("Kandidaten mangler geometri")
    version = {
        "source_key": candidate_source_key(candidate),
        "geometry": geometry,
        "source_updated_at": str(candidate.get("source_updated_at") or ""),
    }
    encoded = json.dumps(version, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def candidate_with_property_identity(
    candidate: dict[str, Any], property_obj: Property
) -> tuple[dict[str, Any], str]:
    enriched = {
        **candidate,
        "property_ref": candidate.get("property_ref")
        or {
            "komm": property_obj.komm,
            "gnr": property_obj.gnr,
            "bnr": property_obj.bnr,
            "fnr": property_obj.fnr,
            "label": property_obj.label,
        },
    }
    return enriched, candidate_source_key(enriched)
