---
slug: photo-henting-feiler-under-filter
reported_by: stabilitetsrunde
---

# Incident: Bildelisting feiler når filter endres raskt

## Scenario
1. Bytt `showOnlyManualQc` eller `showOnlyLowConfidence` av/på flere ganger etter hverandre.
2. Samtidig endres tidsfilter (`year/season`) eller bytter mellom map/album.
3. Flere `apiGet("/api/v1/photos")` og `apiGet("/api/v1/photos/page")` blir kjørt i kø.

## Forventet
Kun siste søkekontekst skal representere UI, tidligere request bør kanselleres med klar status.

## Faktisk
I noen tilfeller oppdateres `photoPool` i en tidligere respons (race), eller feilstatus vises inkonsistent.

## Sporingsinfo
- `App.tsx` har abort-refs per load-løp og sekvenskontroll, men vi ser fortsatt usikkerhet på at kansellering alltid når alle grener.

## Sannsynlig rotårsak
Racing mellom filterkontekster (parallelle request uten dedikert single-flight dedupe på query-bytes) og sekvenshåndtering i flere `useEffect`.

## Fikstiltaksforslag
- Konsolidere til en `useEffect` med avhengighets-hash på hele query-objektet.
- Ekspandere request-id/sekvens-logg i `photosLoadFailed`/`albumLoadFailed`.
- Legge en eksplisitt “refresh” retry i UI med samme query payload.
