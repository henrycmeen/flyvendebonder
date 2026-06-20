# Planlegging workspace v1

`Planlegging` er en ny arbeidsflate i Flyvendebønder for å gjøre eksisterende jorder om til faktisk flybare delplaner.

## Mål
- vise bekreftede jorder som egne planenheter for aktiv eiendom
- dele store jorder manuelt i mindre deljorder
- beregne forventet flytid fra droneprofil og ruteparametre før lagring
- lagre resultatet som ordinære `FlightMission`-oppdrag

## Backend-kontrakt
- `POST /api/v1/planning/properties/{property_id}/sync`
- `GET /api/v1/planning/properties/{property_id}/units`
- `POST /api/v1/planning/units/{unit_id}/split`
- `GET /api/v1/drone-profiles`
- `POST /api/v1/flight-missions/preview`
- `POST /api/v1/flight-missions`

## Viktige regler i v1
- Geonorge/Kartverket sine teigdata er primær kilde for felt- og planleggingsgeometri, i tråd med `docs/drift/kildepolicy-v1.md`.
- NIBIO jordsmonn, AR50, Gårdskart og AR5 skal behandles som kontekst-/overlay-kilder, ikke som eneste kilde til feltvalg.
- bare `confirmed` `FieldPlot` auto-seedes til `PlanningUnit`
- splitting er manuell og lager alltid to nye aktive barn
- original planenhet arkiveres ved vellykket split
- flytidsestimat beregnes fra `route_distance_m`, `waypoint_count` og valgt droneprofil
- `duration_status` settes til `ok`, `warning` eller `over_limit`

## UI-flyt
1. Velg arbeidsflaten `Planlegging`.
2. Synk aktive planenheter for valgt eiendom.
3. Velg én planenhet og aktiver `Del jord` ved behov.
4. Klikk to punkter i kartet for å dele jordet.
5. Velg én eller flere planenheter i listen.
6. Velg droneprofil og juster ruteparametre.
7. Les estimert flytid og lagre som flyoppdrag.
