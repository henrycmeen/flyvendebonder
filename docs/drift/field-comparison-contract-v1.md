# Feltsammenligning v1

## Formål

Feltsammenligning v1 definerer én liten og prototyperbar flyt for å se samme felt på to tidspunkt. Den bygger på eksisterende felthistorikk, flight captures og prosesseringsartefakter. Sammenligningen skal hjelpe brukeren å finne igjen dokumenterte forskjeller uten å presentere automatisk endringsdeteksjon eller agronomiske konklusjoner.

## Brukerflyt

Fra et valgt felt i Planlegging åpner brukeren `Sammenlign over tid` og velger:

1. en tidligere flight capture som venstre tidspunkt
2. en senere flight capture som høyre tidspunkt

Begge captures må være eksplisitt knyttet til samme `field_id`. Flaten viser deretter tidspunkt, kalenderbasert sesongetikett, bildeantall og tilgjengelige ferdige artefakter for hvert tidspunkt side om side. Brukeren kan åpne underliggende bilder og ortofoto, men V1 beregner ikke automatisk hva som har endret seg. Dagens feltrapport er feltomfattende og genereres ved åpning; hvis den lenkes fra sammenligningsflaten, skal den derfor vises én gang utenfor de to sidene som `Nåværende feltrapport`, ikke som historisk evidens for et anker.

## Sammenligningsankre

Et gyldig anker i V1 er en `FlightCapture` som:

- inneholder valgt `field_id` i sitt feltgrunnlag
- har `captured_from` eller `captured_to`
- er lesbar gjennom samme felt-/eiendomstilgangsbeslutning som valgt felt
- fortsatt finnes og kan leses gjennom eksisterende tilgangsregler

`comparison_time` avledes deterministisk som `captured_from` når den finnes, ellers `captured_to`. Captures der både `captured_from` og `captured_to` mangler, er ikke valgbare. `created_at` skal ikke brukes som erstatning for capture-tid. Kandidater sorteres på `comparison_time` og deretter `capture_id`. De to valgte ankrene må ha ulike `comparison_time`. Historikkfeltet `season` er foreløpig bare kalenderåret fra hendelsestidspunktet og skal ikke fremstilles som dokumentert vekstfase eller agronomisk sesong.

Manuelle captures uten eksplisitt feltkobling er ikke valgbare. Feltkobling skal aldri utledes fra foto-GPS, overlay-bounds, eiendomstilhørighet eller filnavn.

Tilgang skal avgjøres før kandidatmetadata returneres. Uautoriserte capture-ID-er skal behandles som ikke funnet, uten å lekke navn, tidspunkt eller eksistens. Kontrakten skal ikke bake direkte bruker-ID-likhet inn i modellen, fordi senere roller og deling må kunne bruke samme feltbaserte tilgangsbeslutning.

## Kontraktskisse

Kontraktnavn: `flyvendebonder.field-comparison`

Versjon: `v1`

```text
field
  id, name, geometry/source provenance

left / right
  capture_id
  captured_from, captured_to
  comparison_time
  label
  photo_count
  completed_artifacts[]
  field_linkage
  limitations[]

comparison_basis
  same_field=true
  ordered_by=["comparison_time", "capture_id"]
  comparable_artifact_kinds[]
  geometry_status="same|changed|unknown"
  quality_status="comparable|partial|not_comparable"
  reasons[]
```

`comparable` betyr bare at grunnlaget kan vises sammen. Det betyr ikke at bilder, ortofoto eller analyser er radiometrisk eller agronomisk direkte sammenlignbare. Dagens capture lagrer felt-ID-er, men ikke et eget uforanderlig geometri-snapshot. `geometry_status` skal derfor være `unknown` med mindre begge ankrene har eksplisitt, uforanderlig capture-tidsproveniens for geometrien. Endret eller ukjent feltgeometri tillater side-ved-side-visning, men skal sperre for kvantitative konklusjoner.

Overlappende capture-intervaller kan vises side om side, men skal gi `quality_status="partial"` og en tydelig årsak. De skal ikke presenteres som et rent før/etter-par.

## Produktuttrykk

Første produktuttrykk skal bruke eksisterende Planlegging-flate og skjermmønstre:

- samme feltidentitet ligger fast øverst
- venstre og høyre tidspunkt har lik struktur og tydelige datoer
- forskjeller uttrykkes som dokumenterte metadata: bildeantall, ferdige prosesseringsløp og felles, tillagte eller manglende artefakttyper
- manglende data vises som `Delvis grunnlag` eller `Kan ikke sammenlignes`, med årsak
- kilder, tidspunkt og begrensninger er synlige nær innholdet

Ingen ny hovednavigasjon, tidslinjemodell eller automatisk analyse er nødvendig for V1.

## Gyldig sammenligningsgrunnlag

V1 kan vise to captures sammen når de gjelder samme felt. Følgende forhold må markeres eksplisitt som begrensninger:

- ulikt eller ukjent capture-tidspunkt
- ulik bildedekning, flyhøyde, kamera eller prosesseringsbane
- manglende eller ulike artefakttyper
- endret feltgeometri eller svak kildeproveniens
- web-ortofoto som er nedskalert eller fargekorrigert
- feltfunn uten eksplisitt observasjonstidspunkt

Manglende evidens betyr `ukjent`, aldri null endring. Feltoppgaver skal ikke plasseres på en historisk side før de har et eget, pålitelig observasjonstidspunkt eller versjonshistorikk.

Fargeprøver fra dagens ortofotoanalyse lagres ikke og er ikke knyttet til `field_id` eller `capture_id`. De kan derfor ikke brukes som vedvarende tidsseriegrunnlag i denne kontrakten.

## Avgrensning

V1 omfatter ikke:

- automatisk endringsdeteksjon, segmentering eller heatmap
- sammenligning av løse bilder uten felles felt
- historiske statusdelta for mutable feltoppgaver
- agronomisk diagnose, risikoscore eller anbefalt tiltak
- normalisering mellom kamera, lysforhold, flyhøyde eller prosesseringsmotor
- persistente RGB-/indeksmålinger eller samme-punkt-delta
- generisk sesongmodell utover dokumenterte tidspunkter og brukerens etiketter

## Implementeringssteg

Videre arbeid deles i:

1. et provider-nøytralt read-only API for to feltbundne capture-ankre
2. et side-ved-side produktuttrykk i eksisterende Planlegging-flate
3. eventuell lagring og sammenligning av analyseprøver som en senere, separat kontrakt

API- og UI-endringer skal dekke tilgang, manglende ankere, delvis grunnlag og deterministisk sortering i tester. Standard repo-validering og stack-smoke skal kjøres når kontrakten implementeres.

## Opphav

- GitHub issue: 192
- Felthistorikk: `docs/drift/field-history-contract-v1.md`
- Feltrapport: `docs/drift/field-report-contract-v1.md`
- Ortofotoanalyse: `docs/drift/orthophoto-color-analysis-v1.md`
