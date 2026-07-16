from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import PlanningUnit, Property
from .operating_area_identity import candidate_id, candidate_source_key
from .planning import find_field_for_candidate


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
    field = find_field_for_candidate(
        db,
        property_obj=property_obj,
        candidate=candidate,
        source_key=source_key,
    )
    if field is None:
        return None
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
    source_key = candidate_source_key(candidate)
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
    allowed["existing"] = existing_connection(
        db, user_id=user_id, candidate=candidate, source_key=source_key
    )
    return allowed
