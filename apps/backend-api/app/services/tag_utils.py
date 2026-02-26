from __future__ import annotations

import json
import math
from typing import Any

SYSTEM_PREFIXES = ("meta:", "qc:")
_TAG_MAX_LENGTH = 72


def _normalize_tag_value(value: str | None) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text[:_TAG_MAX_LENGTH] if text else None


def _coalesce_str_list(values: Any) -> list[str]:
    if not isinstance(values, list):
        return []

    result: list[str] = []
    for value in values:
        normalized = _normalize_tag_value(str(value))
        if normalized is not None:
            result.append(normalized)
    return result


def parse_tag_json(photo_tags_json: str | None) -> list[str]:
    """Parse legacy tags_json payload and return a flattened list."""
    try:
        parsed = json.loads(photo_tags_json or "[]")
    except json.JSONDecodeError:
        return []

    if isinstance(parsed, dict):
        user_tags = _coalesce_str_list(parsed.get("user_tags"))
        system_tags = _coalesce_str_list(parsed.get("system_tags"))
        return [*user_tags, *system_tags]

    return _coalesce_str_list(parsed)


def parse_tag_groups(photo_tags_json: str | None) -> tuple[list[str], list[str]]:
    """Parse tags_json into (user_tags, system_tags)."""
    try:
        parsed = json.loads(photo_tags_json or "[]")
    except json.JSONDecodeError:
        return [], []

    if isinstance(parsed, dict):
        return normalize_user_tags(_coalesce_str_list(parsed.get("user_tags"))), normalize_system_tags(
            _coalesce_str_list(parsed.get("system_tags"))
        )

    return split_tags(_coalesce_str_list(parsed))


def normalize_user_tags(tags: list[str] | None) -> list[str]:
    result: list[str] = []
    seen = set[str]()
    for raw in tags or []:
        tag = _normalize_tag_value(raw)
        if not tag:
            continue

        key = tag.casefold()
        if key in seen:
            continue
        if any(key.startswith(prefix) for prefix in SYSTEM_PREFIXES):
            continue

        seen.add(key)
        result.append(tag)
    return result


def normalize_system_tags(tags: list[str] | None) -> list[str]:
    seen: dict[str, str] = {}
    for raw in tags or []:
        tag = _normalize_tag_value(raw)
        if not tag:
            continue

        key = tag.casefold()
        if key in seen:
            continue
        seen[key] = tag

    return [seen[key] for key in sorted(seen)]


def split_tags(tags: list[str]) -> tuple[list[str], list[str]]:
    user_tags: list[str] = []
    system_tags: list[str] = []

    for tag in tags:
        normalized = _normalize_tag_value(tag)
        if not normalized:
            continue

        key = normalized.casefold()
        if any(key.startswith(prefix) for prefix in SYSTEM_PREFIXES):
            system_tags.append(normalized)
            continue
        user_tags.append(normalized)

    return normalize_user_tags(user_tags), normalize_system_tags(system_tags)


def extract_meta_value(tags: list[str], key: str) -> str | None:
    if not key:
        return None

    prefix = key.rstrip("=") + "="
    prefix_l = prefix.lower()
    for tag in tags:
        if tag.lower().startswith(prefix_l):
            return tag[len(prefix) :].strip()
    return None


def extract_meta_float(tags: list[str], key: str) -> float | None:
    raw = extract_meta_value(tags, key)
    if raw is None:
        return None

    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None

    if not math.isfinite(value):
        return None
    return value


def set_meta_value(tags: list[str], key: str, value: str | None) -> list[str]:
    prefix = key.rstrip("=") + "="
    prefix_l = prefix.lower()
    filtered = [tag for tag in tags if not tag.lower().startswith(prefix_l)]
    if value is None:
        return filtered

    candidate = f"{prefix}{value}"
    user_tags, system_tags = split_tags(filtered)
    if prefix_l.startswith("meta:") or prefix_l.startswith("qc:"):
        return merge_tag_groups(user_tags, [*system_tags, candidate])
    return merge_tag_groups([*user_tags, candidate], system_tags)


def set_quality_flag(tags: list[str], flag: str, enabled: bool | None) -> list[str]:
    if not flag.startswith("qc:"):
        return list(tags)

    user_tags, system_flags = split_tags(tags)
    if enabled is None:
        return merge_tag_groups(user_tags, [tag for tag in system_flags if tag.casefold() != flag.casefold()])

    if enabled:
        return merge_tag_groups(user_tags, [*system_flags, flag])
    return merge_tag_groups(user_tags, system_flags)


def set_system_tags(tags: list[str], system_tags: list[str] | None = None) -> list[str]:
    user_tags, _ = split_tags(tags)
    next_system = normalize_system_tags(system_tags or [])
    return sorted({*user_tags, *next_system}, key=str.lower)


def merge_tag_groups(user_tags: list[str], system_tags: list[str]) -> list[str]:
    return sorted({*normalize_user_tags(user_tags), *normalize_system_tags(system_tags)}, key=str.lower)


def serialize_tag_groups(user_tags: list[str], system_tags: list[str]) -> str:
    payload = {
        "user_tags": normalize_user_tags(user_tags),
        "system_tags": normalize_system_tags(system_tags),
    }
    return json.dumps(payload, ensure_ascii=False)


__all__ = [
    "SYSTEM_PREFIXES",
    "parse_tag_json",
    "parse_tag_groups",
    "normalize_user_tags",
    "normalize_system_tags",
    "split_tags",
    "extract_meta_value",
    "extract_meta_float",
    "set_meta_value",
    "set_quality_flag",
    "set_system_tags",
    "merge_tag_groups",
    "serialize_tag_groups",
]
