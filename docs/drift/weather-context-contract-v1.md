# Vær- og risikokontekst v1

## Formål

Værkontekst v1 skal gi nøytrale værfakta rundt et eksplisitt feltfunn. Den skal hjelpe brukeren å forstå når og under hvilke dokumenterte forhold en observasjon ble gjort, uten å beregne agronomisk risiko, stille diagnose eller foreslå tiltak.

## Beslutning for pilot

V1 er historisk observasjonskontekst, ikke værvarsel. Konteksten knyttes til én lagret feltoppgave via:

- `scouting_task_id`
- oppgavens `field_id`
- et eksplisitt `observed_at`
- oppgavens registrerte posisjon

Dagens feltoppgaver har `created_at` og `updated_at`, men mangler `observed_at`. Før vær kan vises må oppgaven derfor få et valgfritt, korrigerbart observasjonstidspunkt. Eldre oppgaver uten tidspunkt skal stå som `Ukjent observasjonstid`; registreringstid skal ikke presenteres som om den var observasjonstid.

`observed_at` skal være offset-bevisst og normaliseres til UTC, mens opprinnelig offset beholdes som provenance. Snapshotet skal også beholde nøyaktig posisjon og feltkobling som ble brukt ved hentingen.

## Realistisk datakilde

MET Norway Frost er første realistiske kandidat for historiske vær- og klimaobservasjoner i Norge. Frost tilbyr stasjonsbaserte observasjoner og krever registrert klient-ID for datakall. Produksjonsbruk må verifisere dekning, kvalitetskoder, stasjonsvalg, lisens og attribusjon mot offisiell dokumentasjon før adapteren aktiveres.

MET Norway Locationforecast er egnet for koordinatbaserte prognoser, men returnerer gjeldende prognoser og er derfor ikke kilde til et historisk feltfunn i V1. Prognoser, Nowcast og varsling behandles som et senere separat produktspor.

Manuell nedbør- eller stasjonsinput kan brukes som pilotfallback bare når den merkes `manual` med tidspunkt og kilde. Manuelle og leverandørhentede data skal aldri blandes uten synlig provenance.

## Minste signalsats

V1 viser leverandørens dokumenterte målinger, uten terskler eller skjult tidsaggregering:

- nærmeste kvalitetsgodkjente lufttemperaturmåling rundt `observed_at`, med faktisk referansetid og tidsavstand
- siste tilgjengelige nedbørakkumulering som slutter ved eller før `observed_at`, med leverandørens faktiske start, slutt og måleperiode
- ved behov vedvarende vind og vindkast som to separate målinger når kilden tilbyr sammenlignbare elementer

Adapteren skal ikke omtale et fast leverandørintervall som et rullerende døgn, interpolere mellom stasjoner uten å si det eller slå sammen vindkast og vedvarende vind. Manglende signaler skal utelates eller merkes som manglende. V1 skal ikke utlede `frostfare`, `kjørbart`, sykdomspress eller annen risikokategori fra verdiene.

Kandidatserier må være gyldige ved `observed_at`, ha forventet element, nivå og tidsoppløsning, ligge innenfor en versjonert maksimalavstand per element og bruke kvalitetskoder fra en eksplisitt allowlist. Disse grenseverdiene skal verifiseres mot offisiell Frost-dokumentasjon og godkjennes i implementeringssaken før adapteren kan aktiveres. Hvis ingen serie passer, er målingen manglende; noen manglende målinger gir `partial`, og ingen gyldige målinger gir `unavailable`.

## Kontraktskisse

Kontraktnavn: `flyvendebonder.weather-context`

Versjon: `v1`

```text
scouting_task_id
field_id
observed_at
observed_at_original_offset
position
  lat, lng, basis="observation_position"
period
  start, end, timezone
context_type="historical_observation"
measurements[]
  element_id, label
  value, unit
  reference_time
  period_start, period_end
  time_resolution, aggregation
  source_id, station_distance_m
  quality_codes[]
  source_updated_at?
quality
  status="available|partial|unavailable"
  missing_fields[]
provenance
  provider, dataset
  fetched_at
  attribution, license_reference
snapshot
  version, created_at, superseded_at?
  input_observed_at, input_position, input_field_id
limitations[]
```

Kontrakten må tåle at fakta eller hele kilden er utilgjengelig. Feltoppgaven og feltrapporten skal fortsatt fungere når værkontekst mangler eller er utdatert.

Stasjon og tidsserie skal velges per måling etter eksplisitte regler for avstand, tilgjengelig periode, element, nivå og kvalitetskode. Hver måling viser valgt `source_id`, avstand og måletid; V1 skal ikke late som en fjern stasjonsmåling er gjort på selve feltet. Snapshot-proveniens beholder provider/datasett og attribusjon som er felles for alle målingene.

## Snapshot og endringer

Et generert værsnapshot er uforanderlig. Hvis brukeren endrer `observed_at`, posisjon eller feltkobling, markeres eksisterende snapshot som superseded og en ny versjon må genereres før værkontekst vises som aktuell. Historiske versjoner beholdes etter samme retention- og tilgangspolicy som feltfunnet, slik at rapporter kan forklare hvilket inputgrunnlag som ble brukt.

Målingens `source_updated_at` er valgfri og brukes bare når leverandøren faktisk oppgir et revisjonstidspunkt. Snapshotets `fetched_at` skal aldri kopieres inn som en erstatning.

## Produktuttrykk

Første produktuttrykk er en liten seksjon med tittelen `Værkontekst ved observasjonen` i:

- valgt feltoppgave i Planlegging
- den eksisterende utskriftsklare feltrapporten

Seksjonen viser periode, nøytrale måleverdier, kilde, stasjonsavstand eller oppløsning og begrensninger. `Delvis grunnlag` og `Værkontekst utilgjengelig` er normale tilstander. V1 bruker ikke rød/grønn risikofarge, varselkort, ny navigasjon eller automatisk råd.

## Kilde- og driftsregler

- Adapteren skal ligge bak en miljøgate og være avslått når nødvendig identifikasjon eller tilgang mangler.
- Providerfeil skal gi `partial` eller `unavailable`, ikke blokkere feltfunn eller rapport.
- Tester og stack-smoke skal bruke deterministiske fixtures og aldri kalle en ekstern værtjeneste.
- Kildehelse skal følge eksisterende `/api/v1/sources/status`-mønster.
- Cache, lagringstid, attribusjon og klientidentifikasjon skal dokumenteres før live aktivering.
- Ingen credentials eller rå leverandørrespons skal eksponeres i frontend eller rapport.

## Avgrensning

V1 omfatter ikke:

- prognoser, Nowcast, pushvarsler eller operativ flybeslutning
- terskler, risikoscore, agronomisk diagnose eller anbefalt tiltak
- sykdoms-, avlings- eller gjødslingsmodell
- automatisk valg av tiltak basert på nedbør, temperatur eller vind
- værkart, dashboard eller ny navigasjonsmodell
- live aktivering, secret-endringer eller produksjonsdata i kontraktleveransen

## Implementeringssteg

Videre arbeid deles i:

1. eksplisitt `observed_at` på feltoppgaver, med trygg håndtering av eldre data
2. provider-nøytralt, versjonert historisk snapshot med Frost-adapter, provenance, kildevalg og fail-soft
3. samme nøytrale kontekst i feltoppgave og feltrapport

API- og UI-endringer skal dekke tilgjengelig, delvis og utilgjengelig kontekst. Standard repo-validering og stack-smoke skal kjøres ved implementasjon, sammen med visuell kontroll av feltoppgave og printbar rapport.

## Kilder og opphav

- GitHub issue: 193
- MET Norway Locationforecast: https://api.met.no/weatherapi/locationforecast/2.0/documentation
- MET Norway Frost: https://frost.met.no/howto.html
- MET Norway lisens og attribusjon: https://docs.api.met.no/doc/License.html
- Kildepolicy: `docs/drift/kildepolicy-v1.md`
- Feltrapport: `docs/drift/field-report-contract-v1.md`
