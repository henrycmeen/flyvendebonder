from __future__ import annotations

import hashlib
import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import FieldPlot, PlanningUnit, Property
from .planning import find_field_plot_for_geometry


def candidate_id(candidate: dict[str, Any]) -> str:
    property_ref = candidate.get("property_ref")
    geometry = candidate.get("geometry")
    if not isinstance(property_ref, dict) or not isinstance(geometry, dict):
        raise ValueError("Kandidaten mangler matrikkeldata eller geometri")
    identity = {
        "source": candidate.get("source"),
        "komm": str(property_ref.get("komm") or "").strip(),
        "gnr": property_ref.get("gnr"),
        "bnr": property_ref.get("bnr"),
        "fnr": property_ref.get("fnr") or 0,
        "local_id": candidate.get("local_id"),
        "geometry": geometry,
    }
    if not identity["source"] or not identity["komm"] or identity["gnr"] is None or identity["bnr"] is None:
        raise ValueError("Kandidaten mangler gyldig identitet")
    encoded = json.dumps(identity, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def existing_connection(
    db: Session,
    *,
    user_id: int,
    candidate: dict[str, Any],
    source_key: str,
) -> dict[str, Any] | None:
    property_ref = candidate["property_ref"]
    property_obj = (
        db.execute(
            select(Property).where(
                Property.user_id == user_id,
                Property.komm == str(property_ref["komm"]),
                Property.gnr == int(property_ref["gnr"]),
                Property.bnr == int(property_ref["bnr"]),
                Property.fnr == int(property_ref.get("fnr") or 0),
            )
        )
        .scalars()
        .first()
    )
    if property_obj is None:
        return None
    field = (
        db.execute(
            select(FieldPlot).where(
                FieldPlot.property_id == property_obj.id,
                FieldPlot.source == "imported",
                FieldPlot.source_key == source_key,
            )
        )
        .scalars()
        .first()
    )
    if field is None:
        field = find_field_plot_for_geometry(db, property_obj=property_obj, geometry=candidate["geometry"])
    unit_ids = []
    if field is not None:
        unit_ids = list(
            db.execute(
                select(PlanningUnit.id).where(
                    PlanningUnit.property_id == property_obj.id,
                    PlanningUnit.source_field_plot_id == field.id,
                    PlanningUnit.status == "active",
                )
            ).scalars()
        )
    return {
        "property_id": property_obj.id,
        "field_id": field.id if field is not None else None,
        "planning_unit_ids": unit_ids,
        "operating_relation": property_obj.operating_relation,
    }


def candidate_payload(
    db: Session,
    *,
    user_id: int,
    candidate: dict[str, Any],
) -> dict[str, Any]:
    key = candidate_id(candidate)
    allowed = {
        name: candidate.get(name)
        for name in (
            "source",
            "source_endpoint",
            "source_fetched_at",
            "source_updated_at",
            "name",
            "matrikkelnummer",
            "local_id",
            "object_type",
            "accuracy_class",
            "distance_m",
            "geometry",
            "area_m2",
            "area_ha",
        )
    }
    allowed["candidate_id"] = key
    allowed["property_ref"] = candidate["property_ref"]
    allowed["existing"] = existing_connection(db, user_id=user_id, candidate=candidate, source_key=key)
    return allowed
