---
slug: photo-map-inset-krasj-invalid-koordinater
reported_by: stabilitetsrunde
---

# Incident: PhotoMapInset krasjer ved manglende koordinater

## Scenario
1. Åpne bildevisning på et bilde der kildedata mangler GPS-lat/lng eller der manuell redigering av målpunkt lagrer et tomt koordinat-par.
2. `PhotoMapInset` prøver å kjøre `L.latLng(photo.lat, photo.lng)` og/eller `L.latLngBounds(points)` med tom/ugyldig punktliste.
3. Kartutsnittet blir oppdatert med feil data.

## Forventet
Inline-kartet skal vise punkt i tilgjengelige koordinater, eller vise en tomt/sikkert fallback-vist kart uten å kaste JS-feil.

## Faktisk
Feil i leaflet-API ved ugyldige koordinater, som kan føre til krasj i fullskjerm/metadata-ruten og behov for restart av UI.

## Sporingsinfo
- Lignende symptomer ble observert ved raske redigeringssving i metadata.
- Ingen stacktrace fra backend; dette er ren klient-krasj i Leaflet-konstruksjon.

## Sannsynlig rotårsak
Mangler validering før `L.latLng`, `L.polyline` og `L.latLngBounds` i `PhotoMapInset`.

## Fikstiltaksforslag
- Valider `photo.lat/lng`, `target`, `sample_points` og `footprint` før kartoperasjoner.
- Fallback til `setView` når kun ett gyldig punkt finnes.
- Omringe `fitBounds` i `try/catch`.
