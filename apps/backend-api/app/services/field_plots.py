from __future__ import annotations

import math

from .quality_metrics import meters_per_degree_latitude, meters_per_degree_longitude


def normalize_polygon_coordinates(raw_coordinates: list[list[list[float]]]) -> list[list[list[float]]]:
    if not raw_coordinates:
        raise ValueError("Polygon må ha minst én ring")

    normalized_rings: list[list[list[float]]] = []

    for ring_index, raw_ring in enumerate(raw_coordinates):
        if len(raw_ring) < 3:
            raise ValueError("Polygonring må ha minst tre punkter")

        ring: list[list[float]] = []
        for point in raw_ring:
            if len(point) < 2:
                raise ValueError("Hvert punkt må ha lng og lat")

            lng = float(point[0])
            lat = float(point[1])

            if not math.isfinite(lng) or not math.isfinite(lat):
                raise ValueError("Koordinater må være gyldige tall")
            if lng < -180.0 or lng > 180.0 or lat < -90.0 or lat > 90.0:
                raise ValueError("Koordinater er utenfor gyldig område")

            ring.append([lng, lat])

        if ring[0] != ring[-1]:
            ring.append([ring[0][0], ring[0][1]])

        distinct_points = {(round(point[0], 9), round(point[1], 9)) for point in ring[:-1]}
        if len(distinct_points) < 3:
            raise ValueError("Polygon må ha minst tre unike punkter")

        if ring_index > 0 and len(ring) < 4:
            raise ValueError("Hull i polygon må være lukket")

        normalized_rings.append(ring)

    return normalized_rings


def polygon_area_m2(coordinates: list[list[list[float]]]) -> float:
    if not coordinates:
        return 0.0

    outer_area = _ring_area_m2(coordinates[0])
    holes = sum(_ring_area_m2(ring) for ring in coordinates[1:])
    total = max(0.0, outer_area - holes)
    return round(total, 2)


def _ring_area_m2(ring: list[list[float]]) -> float:
    if len(ring) < 4:
        return 0.0

    avg_lat = sum(point[1] for point in ring[:-1]) / max(1, len(ring) - 1)
    meters_lat = meters_per_degree_latitude()
    meters_lng = meters_per_degree_longitude(avg_lat)

    origin_lng, origin_lat = ring[0]
    projected: list[tuple[float, float]] = []
    for lng, lat in ring:
        x = (lng - origin_lng) * meters_lng
        y = (lat - origin_lat) * meters_lat
        projected.append((x, y))

    area = 0.0
    for index in range(len(projected) - 1):
        x1, y1 = projected[index]
        x2, y2 = projected[index + 1]
        area += (x1 * y2) - (x2 * y1)

    return abs(area) / 2.0
