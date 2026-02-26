from __future__ import annotations


def derive_qc_tags(metadata_issues: list[str]) -> list[str]:
    qc_tags: set[str] = set()
    for issue in metadata_issues:
        normalized = issue.lower()
        if "retning" in normalized:
            qc_tags.add("qc:missing_heading")
        elif "pitch" in normalized:
            qc_tags.add("qc:missing_pitch")
        elif "date" in normalized:
            qc_tags.add("qc:missing_timestamp")
        elif "gps" in normalized:
            qc_tags.add("qc:missing_gps")
        elif "høyde" in normalized or "altitude" in normalized:
            qc_tags.add("qc:missing_altitude")
        else:
            qc_tags.add("qc:metadata_issue")

    return sorted(qc_tags)

