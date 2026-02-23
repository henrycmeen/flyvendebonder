#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import math
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any

BACKEND_API_DIR = Path(__file__).resolve().parent.parent / "apps" / "backend-api"
if BACKEND_API_DIR.exists():
    sys.path.insert(0, str(BACKEND_API_DIR))
else:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.geometry_utils import choose_geometry
from app.services.metadata_utils import ExtractedMetadata, extract_metadata
from app.services.quality_metrics import (
    build_analysis_zone as build_shared_analysis_zone,
    derive_analysis_radius,
    derive_location_uncertainty,
    derive_quality_confidence,
)

SUPPORTED_EXTS = {".jpg", ".jpeg", ".tif", ".tiff", ".png"}


def _choose_heading(metadata: ExtractedMetadata) -> tuple[float | None, str]:
    if metadata.flight_yaw_degree is not None:
        return metadata.flight_yaw_degree, "imu"
    if metadata.gimbal_yaw_degree is not None:
        return metadata.gimbal_yaw_degree, "imu"
    if metadata.camera_yaw_degree is not None:
        return metadata.camera_yaw_degree, "imu"
    if metadata.compass is not None:
        return metadata.compass, "gps_course"
    if metadata.heading_deg is not None:
        return metadata.heading_deg, "inferred_from_sequence"
    return None, "unknown"


def _choose_pitch(metadata: ExtractedMetadata) -> tuple[float | None, str]:
    if metadata.gimbal_pitch_degree is not None:
        return metadata.gimbal_pitch_degree, "imu"
    if metadata.flight_pitch_degree is not None:
        return metadata.flight_pitch_degree, "imu"
    if metadata.camera_pitch_degree is not None:
        return metadata.camera_pitch_degree, "imu"
    return None, "unknown"


def _derive_quality_tags(metadata_issues: list[str]) -> list[str]:
    qc_tags: list[str] = []
    for issue in metadata_issues:
        normalized = issue.lower()
        if "retning" in normalized:
            qc_tags.append("qc:missing_heading")
        elif "pitch" in normalized:
            qc_tags.append("qc:missing_pitch")
        elif "date" in normalized:
            qc_tags.append("qc:missing_timestamp")
        elif "gps" in normalized:
            qc_tags.append("qc:missing_gps")
        else:
            qc_tags.append("qc:metadata_issue")
    return sorted(set(qc_tags))


def _build_analysis_zone(
    view_lat: float,
    view_lng: float,
    heading_deg: float | None,
    location_uncertainty_m: float,
    view_distance_m: float | None,
) -> dict[str, Any]:
    return build_shared_analysis_zone(
        center_lat=view_lat,
        center_lng=view_lng,
        heading_deg=heading_deg,
        forward_distance_m=view_distance_m,
        location_uncertainty_m=location_uncertainty_m,
    )


def _derive_quality_confidence(altitude_m: float | None, heading: float | None, pitch: float | None, quality_flags: list[str], geometry_confidence: float) -> tuple[float, list[str]]:
    return derive_quality_confidence(
        altitude_m=altitude_m,
        heading_deg=heading,
        pitch_deg=pitch,
        quality_flags=quality_flags,
        geometry_confidence=geometry_confidence,
    )


def _derive_location_uncertainty(
    altitude_m: float | None,
    pitch: float | None,
    quality_flags: list[str],
    geometry_confidence: float,
    view_mode: str,
) -> float:
    return derive_location_uncertainty(
        altitude_m=altitude_m,
        pitch_deg=pitch,
        quality_flags=quality_flags,
        geometry_confidence=geometry_confidence,
        view_mode=view_mode,
    )


def _derive_analysis_radius(location_uncertainty_m: float | None, view_distance_m: float | None) -> float:
    return derive_analysis_radius(
        location_uncertainty_m=location_uncertainty_m,
        forward_distance_m=view_distance_m,
    )


def _analyze_file(path: Path) -> dict[str, Any]:
    metadata = extract_metadata(path)
    quality_flags = _derive_quality_tags(metadata.issues)
    needs_manual_qc = bool(quality_flags)

    heading, heading_source = _choose_heading(metadata)
    pitch, pitch_source = _choose_pitch(metadata)
    view_lat, view_lng, view_mode = metadata.gps_latitude, metadata.gps_longitude, "point"
    forward_distance_m = None
    view_confidence = 0.6

    if metadata.altitude_m is not None and heading is not None and pitch is not None and metadata.gps_latitude is not None and metadata.gps_longitude is not None:
        geometry = choose_geometry(
            source_lat=metadata.gps_latitude,
            source_lng=metadata.gps_longitude,
            altitude_m=metadata.altitude_m,
            pitch_deg=pitch,
            yaw_deg=heading,
        )
        view_lat = geometry.lat
        view_lng = geometry.lng
        view_mode = geometry.geometry_method
        forward_distance_m = geometry.forward_distance_m
        view_confidence = geometry.confidence

    confidence_score, confidence_reasons = _derive_quality_confidence(
        metadata.altitude_m,
        heading,
        pitch,
        quality_flags,
        view_confidence,
    )
    location_uncertainty_m = _derive_location_uncertainty(
        metadata.altitude_m,
        pitch,
        quality_flags,
        view_confidence,
        view_mode,
    )

    analysis_zone = _build_analysis_zone(
        view_lat=view_lat,
        view_lng=view_lng,
        heading_deg=heading,
        location_uncertainty_m=location_uncertainty_m,
        view_distance_m=forward_distance_m,
    )
    analysis_zone_radius = _derive_analysis_radius(location_uncertainty_m, forward_distance_m)
    view_confidence_pct = view_confidence

    return {
        "file": str(path),
        "source": metadata.source,
        "issues": metadata.issues,
        "needs_manual_qc": needs_manual_qc,
        "quality_flags": quality_flags,
        "captured_at": metadata.captured_at.isoformat() if metadata.captured_at else None,
        "gps_latitude": metadata.gps_latitude,
        "gps_longitude": metadata.gps_longitude,
        "altitude_m": metadata.altitude_m,
        "heading_deg": heading,
        "pitch_deg": pitch,
        "heading_source": heading_source,
        "pitch_source": pitch_source,
        "view_lat": view_lat,
        "view_lng": view_lng,
        "view_mode": view_mode,
        "view_distance_m": forward_distance_m,
        "view_confidence": view_confidence_pct,
        "confidence_score": confidence_score,
        "confidence_reasons": confidence_reasons,
        "location_uncertainty_m": location_uncertainty_m,
        "analysis_zone": analysis_zone,
        "analysis_zone_radius_m": round(analysis_zone_radius, 2),
        "analysis_area_m2": round(math.pi * analysis_zone_radius ** 2, 2),
    }


def _scan_images(source: Path) -> list[Path]:
    if not source.exists() or not source.is_dir():
        raise FileNotFoundError(f"Kildekatalog finnes ikke: {source}")

    return sorted(
        path for path in source.rglob("*") if path.is_file() and path.suffix.lower() in SUPPORTED_EXTS
    )


def _build_summary(entries: list[dict[str, Any]], min_confidence: float) -> dict[str, Any]:
    counter = Counter[str]()
    total = len(entries)

    for entry in entries:
        for issue in entry["issues"]:
            counter[f"issue:{issue}"] += 1
        for flag in entry["quality_flags"]:
            counter[f"flag:{flag}"] += 1

    return {
        "total_files": total,
        "need_manual_qc": sum(1 for entry in entries if entry["needs_manual_qc"]),
        "low_confidence": sum(1 for entry in entries if entry["confidence_score"] < min_confidence),
        "flags": {key.removeprefix("flag:"): value for key, value in sorted(counter.items()) if key.startswith("flag:")},
        "issues": [
            {"issue": key.removeprefix("issue:"), "count": count}
            for key, count in sorted(counter.items())
            if key.startswith("issue:")
        ],
        "mean_confidence": round(
            sum(entry["confidence_score"] for entry in entries) / total, 4
        ) if total else 0.0,
    }


def _build_samples(entries: list[dict[str, Any]], limit: int) -> dict[str, list[dict[str, Any]]]:
    return {
        "missing_heading_or_pitch": [entry for entry in entries if entry["heading_deg"] is None or entry["pitch_deg"] is None][:limit],
        "missing_gps": [
            entry
            for entry in entries
            if entry["gps_latitude"] is None or entry["gps_longitude"] is None
        ][:limit],
        "low_confidence": sorted(
            [entry for entry in entries if entry["confidence_score"] < 0.7],
            key=lambda item: item["confidence_score"],
        )[:limit],
    }


def _write_csv(entries: list[dict[str, Any]], output: Path) -> None:
    if not entries:
        return
    fieldnames = sorted({key for entry in entries for key in entry.keys()})
    with output.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(entries)


def _print_summary(summary: dict[str, Any], samples: dict[str, list[dict[str, Any]]]) -> None:
    print("Photo metadata QC")
    print("=================")
    print(f"Total filer: {summary['total_files']}")
    print(f"Mangler_manual QC: {summary['need_manual_qc']}")
    print(f"Under terskel ({summary.get('min_confidence_threshold', 'n/a')}): {summary['low_confidence']}")
    print(f"Snitt-confidence: {summary['mean_confidence']}")

    if summary["issues"]:
        print("\nMest vanlige issues:")
        for item in summary["issues"][:10]:
            print(f" - {item['count']:4d}  {item['issue']}")

    print("\nKvalitetseksempler:")
    print(f"  missing_heading_or_pitch: {len(samples['missing_heading_or_pitch'])}")
    print(f"  missing_gps: {len(samples['missing_gps'])}")
    print(f"  low_confidence: {len(samples['low_confidence'])}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Kjør metadatakvalitet på en bildekatalog.")
    parser.add_argument("--source", type=Path, default=Path("/Users/henmee/Movies/Droneshots/Meen gård/Analysebilder"), help="Bildekatalog.")
    parser.add_argument("--output", type=Path, default=Path(__file__).with_name("photo_qc_report.json"), help="JSON-rapport-fil.")
    parser.add_argument("--csv", type=Path, default=None, help="Valgfri CSV-eksport av filnivådata.")
    parser.add_argument("--max-files", type=int, default=0, help="Begrens antall filer (0 = alle).")
    parser.add_argument("--sample", type=int, default=25, help="Antall eksempellinjer per sample-gruppe.")
    parser.add_argument("--min-confidence", type=float, default=0.72, help="Flagg filer under denne terskelen.")
    parser.add_argument("--pretty", action="store_true", help="Pen JSON-formatert output.")
    args = parser.parse_args(argv)

    files = _scan_images(args.source)
    if args.max_files > 0:
        files = files[: args.max_files]

    entries = []
    parse_errors = 0
    for path in files:
        try:
            entries.append(_analyze_file(path))
        except Exception as exc:  # noqa: BLE001
            parse_errors += 1
            fallback_radius_m = _derive_analysis_radius(location_uncertainty_m=30.0, forward_distance_m=None)
            entries.append(
                {
                    "file": str(path),
                    "source": None,
                    "issues": [str(exc)],
                    "needs_manual_qc": True,
                    "quality_flags": ["qc:metadata_parse_error"],
                    "captured_at": None,
                    "gps_latitude": None,
                    "gps_longitude": None,
                    "altitude_m": None,
                    "heading_deg": None,
                    "pitch_deg": None,
                    "heading_source": "unknown",
                    "pitch_source": "unknown",
                    "view_lat": None,
                    "view_lng": None,
                    "view_mode": None,
                    "view_distance_m": None,
                    "view_confidence": 0.0,
                    "confidence_score": 0.0,
                    "confidence_reasons": ["parse_error"],
                    "location_uncertainty_m": 30.0,
                    "analysis_zone_radius_m": round(fallback_radius_m, 2),
                    "analysis_area_m2": round(math.pi * fallback_radius_m ** 2, 2),
                }
            )

    min_confidence = args.min_confidence
    summary = _build_summary(entries, min_confidence)
    summary["parse_errors"] = parse_errors
    summary["min_confidence_threshold"] = min_confidence
    samples = _build_samples(entries, args.sample)

    report = {
        "generated_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "source": str(args.source),
        "summary": summary,
        "samples": samples,
        "files": entries,
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    json_payload = json.dumps(report, ensure_ascii=False, indent=2 if args.pretty else None)
    args.output.write_text(json_payload, encoding="utf-8")
    if args.csv is not None:
        _write_csv(entries, args.csv)

    _print_summary(summary, samples)
    print(f"Skrive rapport: {args.output}")
    if args.csv is not None:
        print(f"Skrive csv: {args.csv}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
