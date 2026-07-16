from __future__ import annotations

from collections.abc import Collection
from dataclasses import dataclass
from typing import Literal


AccessScope = Literal["farm", "shared"]

FARM_SCOPE: AccessScope = "farm"
SHARED_SCOPE: AccessScope = "shared"
ACTIVE_MEMBERSHIP_STATUS = "active"

CAPABILITIES = (
    "field.read",
    "field.write",
    "finding.read",
    "finding.write",
    "report.read",
    "report.write",
    "report.export",
    "share.manage",
    "member.manage",
    "farm.manage",
)

_ROLE_CAPABILITY_SCOPES: dict[str, dict[str, AccessScope]] = {
    "owner": {capability: FARM_SCOPE for capability in CAPABILITIES},
    "operator": {
        "field.read": FARM_SCOPE,
        "field.write": FARM_SCOPE,
        "finding.read": FARM_SCOPE,
        "finding.write": FARM_SCOPE,
        "report.read": FARM_SCOPE,
        "report.write": FARM_SCOPE,
        "report.export": FARM_SCOPE,
    },
    "advisor": {
        "field.read": SHARED_SCOPE,
        "finding.read": SHARED_SCOPE,
        "finding.write": SHARED_SCOPE,
        "report.read": SHARED_SCOPE,
        "report.export": SHARED_SCOPE,
    },
    "viewer": {
        "field.read": SHARED_SCOPE,
        "finding.read": SHARED_SCOPE,
        "report.read": SHARED_SCOPE,
        "report.export": SHARED_SCOPE,
    },
}


@dataclass(frozen=True)
class MembershipAccess:
    user_id: int
    farm_id: int
    role: str
    status: str

    def allows(
        self,
        capability: str,
        *,
        granted_capabilities: Collection[str] = (),
    ) -> bool:
        return membership_allows(
            role=self.role,
            status=self.status,
            capability=capability,
            granted_capabilities=granted_capabilities,
        )


def capability_scope(role: str, capability: str) -> AccessScope | None:
    """Return the maximum scope allowed by a role, or deny by default."""

    if capability not in CAPABILITIES:
        return None
    return _ROLE_CAPABILITY_SCOPES.get(role, {}).get(capability)


def membership_allows(
    *,
    role: str,
    status: str,
    capability: str,
    granted_capabilities: Collection[str] = (),
) -> bool:
    """Evaluate role, membership state and optional object-level grants."""

    if status != ACTIVE_MEMBERSHIP_STATUS:
        return False

    scope = capability_scope(role, capability)
    if scope == FARM_SCOPE:
        return True
    if scope == SHARED_SCOPE:
        return capability in granted_capabilities
    return False


def roles_with_farm_capability(capability: str) -> tuple[str, ...]:
    """Return roles that may use a capability across their whole farm."""

    return tuple(
        role
        for role in _ROLE_CAPABILITY_SCOPES
        if capability_scope(role, capability) == FARM_SCOPE
    )
