# Flyvendebønder – Dokumentasjon

## Mapper
- `docs/brand/` – logo og branding
- `docs/drift/` – drift, deploy og operativ oppsett
- `docs/forretning/` – forretningsplaner
- `docs/innsikt/` – markeds/teknisk innsikt og notater
- `docs/backend-processing-v0.md` – første processing-arkitektur for flight captures, jobs og artefakter
- `docs/drift/stac-contract-v1.md` – første STAC-kontrakt for collections og items over processing-runs
- `docs/drift/video-job-contract-v1.md` – minimal backend-kontrakt for videoflyten
- `docs/drift/compliance-retention-v1.md` – operativ sjekkliste og retention-policy for geodata, media, logger og debug-artefakter
- `docs/drift/geojson-contract-v1.md` – første versjonerte GeoJSON-kontrakt for eksport/import av vektordata
- `docs/drift/planlegging-workspace-v1.md` – første kontrakt for den nye planleggingsarbeidsflaten
- `docs/drift/orthophoto-color-analysis-v1.md` – avgrensing og videre backend/COG-spor for fargeanalyse i ortofoto
- `docs/drift/field-report-contract-v1.md` – printbar rapportkontrakt for felt, funn, nøkkelbilder og leveransehistorikk
- `docs/drift/field-comparison-contract-v1.md` – feltbundet to-tidspunkt-sammenligning med eksplisitt grunnlag og begrensninger
- `docs/drift/weather-context-contract-v1.md` – nøytral historisk værkontekst for feltfunn med provenance og fail-soft
- `docs/drift/dji-wpml-export-v1.md` – første ekte DJI KMZ/WPML-eksport for støttede enterprise-profiler
- `docs/drift/dji-fly-mini4pro-export-v1.md` – første Mini 4 Pro / DJI Fly KMZ-eksport og praktisk filflyt
- `docs/skjermkontrakter-v1.md` – produktkontrakter for Kart, Album, Import og Fotoinspektør
- `GitHub Issues` – backlog, prioritering og prosjektstatus (`https://github.com/henrycmeen/flyvendebonder/issues`)
- `docs/status/` – statuslogg av det som er bygget

## Prioriterte startpunkter
- `docs/backend-processing-v0.md` – hvordan foto, flight captures og processing-runs henger sammen
- `docs/drift/stac-contract-v1.md` – hvordan STAC-sporet kobles til flight captures og artefakter
- `docs/drift/cline-kanban-oppsett.md` – oppsett av Cline Kanban og Linear MCP
- `docs/drift/agentarbeid-flyt.md` – operativ arbeidsflyt for agentarbeid
- `docs/status/2026-02-17.md` – nåværende oppsummering av gjennomført arbeid
- `docs/drift/video-job-contract-v1.md` – minimal backend-kontrakt for videoflyten
- `docs/drift/compliance-retention-v1.md` – hva nye dataflyter må avklare, og hvordan midlertidige drifts- og mediaartefakter håndteres
- `docs/drift/geojson-contract-v1.md` – første versjonerte GeoJSON-kontrakt for eksport/import av vektordata
- `docs/drift/planlegging-workspace-v1.md` – hvordan planenheter, splitting og flytidsestimat fungerer
- `docs/drift/orthophoto-color-analysis-v1.md` – hva fargeanalyse v1 beregner og hva den ikke skal tolkes som
- `docs/drift/field-report-contract-v1.md` – hvordan feltrapport v1 bygger på eksplisitte funn og feltbundet evidens
- `docs/drift/field-comparison-contract-v1.md` – hvordan samme felt kan sammenlignes mellom to capture-tidspunkt uten automatisk tolkning
- `docs/drift/weather-context-contract-v1.md` – hvordan historiske værfakta kan knyttes til feltfunn uten risikoscore eller råd
- `docs/drift/dji-wpml-export-v1.md` – hva som faktisk eksporteres som DJI KMZ, og hva som fortsatt faller tilbake til bundle
- `docs/drift/dji-fly-mini4pro-export-v1.md` – hvordan Mini 4 Pro bruker DJI Fly-sporet i stedet for Pilot 2
- `docs/skjermkontrakter-v1.md` – hvilke jobber appens kjerneflater skal gjøre
- `GitHub Issues` – prioritering, triage og milestone-rekkefølge
- `AGENTS.md` – interne arbeidsregler for repoet
