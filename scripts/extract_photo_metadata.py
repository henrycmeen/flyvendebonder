#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

sys.path.append(str(Path(__file__).resolve().parent.parent / "apps" / "backend-api"))

from app.services.metadata_utils import ExtractedMetadata, extract_metadata  # type: ignore  # noqa: E402


SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".tif", ".tiff", ".png"}


@dataclass
class FieldReport:
    total: int
    present: dict[str, int]
    missing: dict[str, int]
    issues: Counter[str]


def _scan_paths(source: Path) -> list[Path]:
    if not source.exists() or not source.is_dir():
        raise FileNotFoundError(f"Kildekatalog finnes ikke: {source}")
    return sorted(path for path in source.rglob("*") if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS)


def _build_report(entries: list[ExtractedMetadata]) -> FieldReport:
    counter = Counter[str]()
    for entry in entries:
        for field, value in [
            ("captured_at", entry.captured_at),
            ("gps_latitude", entry.gps_latitude),
            ("gps_longitude", entry.gps_longitude),
            ("altitude_m", entry.altitude_m),
            ("heading_deg", entry.heading_deg),
            ("compass", entry.compass),
            ("flight_yaw_degree", entry.flight_yaw_degree),
            ("flight_pitch_degree", entry.flight_pitch_degree),
            ("gimbal_pitch_degree", entry.gimbal_pitch_degree),
            ("gimbal_yaw_degree", entry.gimbal_yaw_degree),
            ("camera_pitch_degree", entry.camera_pitch_degree),
            ("camera_yaw_degree", entry.camera_yaw_degree),
        ]:
            counter[f"present:{field}"] += 1 if value is not None else 0
            counter[f"missing:{field}"] += 0 if value is not None else 1

        for issue in entry.issues:
            counter[f"issue:{issue}"] += 1

    fields = [
        "captured_at",
        "gps_latitude",
        "gps_longitude",
        "altitude_m",
        "heading_deg",
        "compass",
        "flight_yaw_degree",
        "flight_pitch_degree",
        "gimbal_pitch_degree",
        "gimbal_yaw_degree",
        "camera_pitch_degree",
        "camera_yaw_degree",
    ]

    present = {field: counter[f"present:{field}"] for field in fields}
    missing = {field: counter[f"missing:{field}"] for field in fields}

    return FieldReport(total=len(entries), present=present, missing=missing, issues=counter)


def _serialize_entry(entry: ExtractedMetadata) -> dict[str, Any]:
    return {
        "file": entry.source_file,
        "source": entry.source,
        "issues": entry.issues,
        "captured_at": entry.captured_at.isoformat() if entry.captured_at else None,
        "gps_latitude": entry.gps_latitude,
        "gps_longitude": entry.gps_longitude,
        "altitude_m": entry.altitude_m,
        "heading_deg": entry.heading_deg,
        "flight_yaw_degree": entry.flight_yaw_degree,
        "flight_pitch_degree": entry.flight_pitch_degree,
        "gimbal_pitch_degree": entry.gimbal_pitch_degree,
        "gimbal_yaw_degree": entry.gimbal_yaw_degree,
        "compass": entry.compass,
        "camera_pitch_degree": entry.camera_pitch_degree,
        "camera_yaw_degree": entry.camera_yaw_degree,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Ekstrahér metadata fra bildekatalog og lagrer rapport.")
    parser.add_argument(
        "--source",
        type=Path,
        default=Path("/Users/henmee/Movies/Droneshots/Meen gård/Analysebilder"),
        help="Kildemappe med bilder.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().with_name("photo_metadata_report.json"),
        help="Fil for rapportdata.",
    )
    parser.add_argument("--max-files", type=int, default=0, help="Begrens antall filer (0 = alle).")
    parser.add_argument(
        "--sample",
        type=int,
        default=40,
        help="Antall eksempelrader for hvert manglende-felt-filter.",
    )
    args = parser.parse_args(argv)

    entries: list[ExtractedMetadata] = []
    files = _scan_paths(args.source)
    if args.max_files > 0:
        files = files[: args.max_files]

    for file_path in files:
        entries.append(extract_metadata(file_path))

    summary = _build_report(entries)
    report = {
        "generated_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "source": str(args.source),
        "summary": {
            "total_files": summary.total,
            "present": summary.present,
            "missing": summary.missing,
            "issues": [
                {"issue": key.removeprefix("issue:"), "count": count}
                for key, count in sorted(summary.issues.items())
                if key.startswith("issue:")
            ],
        },
        "samples": {
            "missing_gps_or_direction": [
                _serialize_entry(entry)
                for entry in entries
                if (entry.gps_latitude is None or entry.gps_longitude is None or entry.heading_deg is None)
            ][: args.sample],
            "missing_pitch": [
                _serialize_entry(entry)
                for entry in entries
                if (
                    entry.flight_pitch_degree is None
                    and entry.gimbal_pitch_degree is None
                    and entry.camera_pitch_degree is None
                )
            ][: args.sample],
        },
        "files": [_serialize_entry(entry) for entry in entries],
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Skrev metadata-rapport: {args.output}")
    print(f"Total filer: {summary.total}")
    for field in sorted(summary.present):
        present = summary.present[field]
        print(f" - {field}: {present} av {summary.total} har verdi ({summary.missing[field]} mangler)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
