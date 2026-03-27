# Felthistorikk v1

`HEN-36` etablerer første backend-kontrakt for felthistorikk i Flyvendebønder.

## Mål

Gi ett felt en sammenhengende historikk over:

- oppdrag
- captures
- processing-runs
- enkle leveranser

Dette er ikke en full rapportmotor. Målet er å gi et feltarkiv som senere kan brukes av rapportgenerator, sammenligning over tid og kundeleveranser.

## Endepunkt

- `GET /api/v1/fields/{field_id}/history`

Responsen returnerer:

- selve feltet
- antall oppdrag
- antall captures
- antall processing-runs
- antall leveranser
- en kronologisk liste over historikkhendelser

## Hendelsestyper i v1

- `mission`
- `capture`
- `processing_run`

Hver hendelse har minst:

- `occurred_at`
- `season`
- `title`
- `status`
- `summary`

I tillegg eksponeres relevante referanser som `mission_id`, `capture_id`, `processing_run_id`, `photo_count`, `provider`, `artifact_count` og `artifact_kinds` når de finnes.

## Avgrensning

Felthistorikk v1 inkluderer ikke:

- frie notater eller scouting-funn
- fotoanalyse direkte på feltnivå
- videojobber
- PDF/HTML-rapportgenerering
- sammenligningslogikk mellom sesonger

Det kommer i senere saker.

## Leveransedefinisjon i v1

`delivery_count` regnes som antall `processing_run`-hendelser som:

- har status `completed`
- og minst ett artifact

Dette er bevisst enkelt. Vi skiller ennå ikke mellom interne og kundeferdige leveranser.

## Hvorfor denne formen

Denne kontrakten holder historikken tett koblet til feltet og backend-domenet som allerede finnes:

- `FieldPlot`
- `FlightMission`
- `FlightCapture`
- `ProcessingRun`
- `ProcessingArtifact`

Dermed kan frontend senere vise historikk uten å måtte finne opp egen sammenbindingslogikk først.
