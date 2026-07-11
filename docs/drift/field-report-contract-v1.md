# Feltrapport-kontrakt v1

## Formål

Feltrapport v1 samler eksisterende, feltbundet evidens i en kort rapport som kan leses i nettleseren og skrives ut eller lagres som PDF. Rapporten skal være forståelig for bonde, rådgiver og intern oppfølging uten å presentere automatiske agronomiske konklusjoner.

Første format er en printbar webside. Dette holder leveransen liten og gjør at PDF kan produseres med nettleserens utskriftsfunksjon uten en egen dokumentgenerator.

## Endepunkter

- `GET /api/v1/fields/{field_id}/report` returnerer den maskinlesbare kontrakten.
- `GET /api/v1/fields/{field_id}/report.html` returnerer samme rapport som printbar HTML.

Begge endepunktene er skrivebeskyttede, følger brukerens eksisterende felttilgang og svarer med `Cache-Control: no-store`.

## Kontrakt

Kontraktnavn: `flyvendebonder.field-report`

Versjon: `v1`

Rapporten inneholder:

- eiendoms- og feltidentitet, areal, feltstatus og kildeproveniens
- oppsummerte antall oppdrag, captures, prosesseringsløp og ferdige leveranser
- feltoppgaver som hovedfunn, med forfatterens tittel, notat, status, prioritet og posisjon
- eksplisitt lenkede nøkkelbilder fra feltoppgavene
- kronologisk feltaktivitet fra den eksisterende historikk-kontrakten
- observerte artefakttyper fra ferdige prosesseringsløp
- faste begrensninger som forklarer hva rapporten ikke konkluderer om

## Evidensregler

- Et hovedfunn er et lagret feltoppgavefunn. Rapporten genererer ikke diagnose, tiltak eller agronomisk råd.
- Et nøkkelbilde må være eksplisitt knyttet til et feltfunn. Eiendomsbilder kobles ikke til felt ved geografisk gjetting.
- Ortofoto omtales bare når et feltbundet capture/prosesseringsløp har en relevant artefakt.
- Brukerskrevet innhold HTML-escapes før rendering.
- Rapporten er et øyeblikksbilde ved åpning, ikke et arkivert eller signert leveransedokument.

## Avgrensning

V1 omfatter ikke:

- offentlig delingslenke eller ny rolle-/tilgangsmodell
- persistente rapportversjoner eller godkjenningsflyt
- servergenerert PDF
- automatisk agronomisk tolkning
- sesong- eller datodifferanser
- vær- og risikodata

## Validering

Backend-testene skal dekke komplett feltkjede, tom rapport, tilgang/404, deduplisering av nøkkelbilder og sikker HTML-escaping. Ved endringer i API eller Planlegging skal standard repo-validering og stack-smoke kjøres. En representativ rapport skal i tillegg åpnes fra valgt planenhet og kontrolleres visuelt i desktop- og mobilbredde før saken kan regnes som levert.
