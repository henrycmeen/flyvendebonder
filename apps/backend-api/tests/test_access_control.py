from __future__ import annotations

import ast
from pathlib import Path

import pytest

from app.services.access_control import (
    FARM_SCOPE,
    MembershipAccess,
    SHARED_SCOPE,
    capability_scope,
    membership_allows,
    roles_with_farm_capability,
)


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

EXPECTED_MATRIX = {
    "owner": {capability: FARM_SCOPE for capability in CAPABILITIES},
    "operator": {
        "field.read": FARM_SCOPE,
        "field.write": FARM_SCOPE,
        "finding.read": FARM_SCOPE,
        "finding.write": FARM_SCOPE,
        "report.read": FARM_SCOPE,
        "report.write": FARM_SCOPE,
        "report.export": FARM_SCOPE,
        "share.manage": None,
        "member.manage": None,
        "farm.manage": None,
    },
    "advisor": {
        "field.read": SHARED_SCOPE,
        "field.write": None,
        "finding.read": SHARED_SCOPE,
        "finding.write": SHARED_SCOPE,
        "report.read": SHARED_SCOPE,
        "report.write": None,
        "report.export": SHARED_SCOPE,
        "share.manage": None,
        "member.manage": None,
        "farm.manage": None,
    },
    "viewer": {
        "field.read": SHARED_SCOPE,
        "field.write": None,
        "finding.read": SHARED_SCOPE,
        "finding.write": None,
        "report.read": SHARED_SCOPE,
        "report.write": None,
        "report.export": SHARED_SCOPE,
        "share.manage": None,
        "member.manage": None,
        "farm.manage": None,
    },
}


@pytest.mark.parametrize(
    ("role", "capability", "expected_scope"),
    [
        (role, capability, expected_scope)
        for role, role_matrix in EXPECTED_MATRIX.items()
        for capability, expected_scope in role_matrix.items()
    ],
)
def test_role_capability_matrix_matches_contract(
    role: str,
    capability: str,
    expected_scope: str | None,
) -> None:
    assert capability_scope(role, capability) == expected_scope


@pytest.mark.parametrize("role", ["advisor", "viewer"])
def test_shared_capabilities_require_explicit_matching_grant(role: str) -> None:
    assert membership_allows(
        role=role,
        status="active",
        capability="field.read",
    ) is False
    assert membership_allows(
        role=role,
        status="active",
        capability="field.read",
        granted_capabilities={"report.read"},
    ) is False
    assert membership_allows(
        role=role,
        status="active",
        capability="field.read",
        granted_capabilities={"field.read"},
    ) is True


@pytest.mark.parametrize("status", ["invited", "revoked", "expired", "unknown"])
def test_inactive_memberships_fail_closed_even_with_a_grant(status: str) -> None:
    assert membership_allows(
        role="advisor",
        status=status,
        capability="finding.write",
        granted_capabilities={"finding.write"},
    ) is False


def test_unknown_role_or_capability_fails_closed() -> None:
    assert capability_scope("superadmin", "field.read") is None
    assert capability_scope("owner", "unknown.write") is None
    assert membership_allows(role="superadmin", status="active", capability="field.read") is False
    assert membership_allows(role="owner", status="active", capability="unknown.write") is False
    assert roles_with_farm_capability("unknown.write") == ()


def test_membership_context_carries_tenant_and_evaluates_policy() -> None:
    membership = MembershipAccess(
        user_id=7,
        farm_id=11,
        role="operator",
        status="active",
    )

    assert membership.user_id == 7
    assert membership.farm_id == 11
    assert membership.allows("field.write") is True
    assert membership.allows("member.manage") is False


def test_membership_context_keeps_shared_roles_fail_closed_without_grant() -> None:
    membership = MembershipAccess(
        user_id=8,
        farm_id=11,
        role="advisor",
        status="active",
    )

    assert membership.allows("finding.write") is False
    assert membership.allows("finding.write", granted_capabilities={"finding.write"}) is True


def test_farm_capability_role_lookup_is_central_and_stable() -> None:
    assert roles_with_farm_capability("field.write") == ("owner", "operator")
    assert roles_with_farm_capability("share.manage") == ("owner",)
    assert roles_with_farm_capability("field.read") == ("owner", "operator")


def test_api_layer_does_not_define_local_multi_role_policy_lists() -> None:
    source_path = Path(__file__).parents[1] / "app" / "api" / "v1.py"
    tree = ast.parse(source_path.read_text(encoding="utf-8"))
    contract_roles = set(EXPECTED_MATRIX)

    for node in ast.walk(tree):
        if not isinstance(node, (ast.List, ast.Set, ast.Tuple)):
            continue
        literal_roles = {
            item.value
            for item in node.elts
            if isinstance(item, ast.Constant) and isinstance(item.value, str)
        }
        assert len(literal_roles & contract_roles) < 2
