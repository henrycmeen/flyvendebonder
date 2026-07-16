from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import FarmMembership, User


class PilotIdentityConfigurationError(RuntimeError):
    """Raised when the single-admin pilot identity cannot be resolved safely."""


def resolve_pilot_owner(db: Session) -> User | None:
    """Resolve the stable owner identity used by the single-admin pilot flow.

    An explicit ADMIN_USER_ID always wins. Without one, a database with exactly
    one active owner is safe to infer. No owner is a valid bootstrap state;
    multiple owners require explicit configuration.
    """

    configured_user_id = get_settings().admin_user_id
    if configured_user_id is not None:
        user = db.get(User, configured_user_id)
        if user is None or not _has_active_owner_membership(db, user.id):
            raise PilotIdentityConfigurationError(
                "ADMIN_USER_ID må peke på en bruker med aktivt eiermedlemskap"
            )
        return user

    owners = (
        db.execute(
            select(User)
            .join(FarmMembership, FarmMembership.user_id == User.id)
            .where(FarmMembership.role == "owner")
            .where(FarmMembership.status == "active")
            .order_by(User.id)
        )
        .scalars()
        .unique()
        .all()
    )
    if len(owners) > 1:
        raise PilotIdentityConfigurationError(
            "Flere aktive eiere krever eksplisitt ADMIN_USER_ID"
        )
    if owners:
        return owners[0]

    existing_user_id = db.execute(select(User.id).limit(1)).scalars().first()
    if existing_user_id is not None:
        raise PilotIdentityConfigurationError(
            "Eksisterende brukere uten aktiv eier kan ikke bootstrappe pilotidentitet"
        )
    return None


def _has_active_owner_membership(db: Session, user_id: int) -> bool:
    membership_id = (
        db.execute(
            select(FarmMembership.id)
            .where(FarmMembership.user_id == user_id)
            .where(FarmMembership.role == "owner")
            .where(FarmMembership.status == "active")
            .limit(1)
        )
        .scalars()
        .first()
    )
    return membership_id is not None
