# Skjermkontrakter v1

Dette notatet eier produktklarheten for de fire kjerneflatene i web-appen:
`Kart`, `Album`, `Import` og `Fotoinspektør`. Målet er at hver flate har en
tydelig jobb, et begrenset handlingssett og en prioriterbar vei videre.

## Kildegrunnlag

- `apps/web-app/src/App.tsx` orkestrerer ruter, fotolast, valgt foto,
  bildevisning, import og metadataredigering.
- `apps/web-app/src/components/app-sidebar.tsx` definerer hovednavigasjonen:
  Kart, Planlegging, Album, Ortofotoene og Import når import er aktiv.
- `apps/web-app/src/components/filter-panel.tsx` og
  `apps/web-app/src/components/map-layer-panel.tsx` legger de viktigste
  kartkontrollene oppå kartflaten.
- `apps/web-app/src/components/album-page.tsx` er samlingsflaten for bilder
  med søk, år/sesong-tokens og uendelig lasting.
- `apps/web-app/src/components/media-import-page.tsx` er browserimport v1 for
  JPG/JPEG/TIF/TIFF via media-staging.
- Fotoinspektøren ligger foreløpig inline i `App.tsx` som fullskjerms
  `photo-viewer-*`-flyt med bilde, strip, analyse, metadata og kartutsnitt.

## Kontrakt: Kart

**Primærjobb:** gi operativ oversikt over hvor bilder, ortofoto og aktive
eiendomslag ligger i terrenget akkurat nå.

**Sekundæroppgaver:**
- filtrere kartet på år og sesong
- bytte bakgrunnskart og skru eiendomsgrenser/jordsmonn av og på
- åpne fotoinspektør fra markør eller hover-preview
- fokusere kartet på ortofoto eller valgt foto fra andre flater

**Viktigste beslutning:** brukeren skal kunne velge hvilket geografisk bevis
som er relevant for neste handling: foto, ortofoto, eiendomsgrense eller
jordsmonn.

**Retningslinje:** kartet er arbeidsflaten. Kontroller skal være små,
midlertidige og kontekstuelle. Hvis en handling krever lesing eller redigering
over tid, skal den ut av kartet og inn i egen flate eller fotoinspektør.

## Kontrakt: Album

**Primærjobb:** finne igjen og sammenligne bilder uten å måtte bruke kartet.

**Sekundæroppgaver:**
- søke på fritekst, år og sesong
- bla gjennom bildesamlingen i nyeste-først rekkefølge
- laste mer uten at brukeren mister filterkontekst
- åpne valgt bilde i fotoinspektør

**Viktigste beslutning:** brukeren skal kunne velge hvilket bilde eller hvilken
gruppe bilder som skal vurderes videre.

**Retningslinje:** albumet er samlings- og gjenfinningsflaten, ikke
metadataredigeringens hovedflate. Albumkort bør lede til fotoinspektør når
brukeren trenger analyse, posisjon eller manuell QC.

## Kontrakt: Import

**Primærjobb:** få nye bildefiler trygt inn i systemet via en tydelig,
kontrollerbar staging-flyt.

**Sekundæroppgaver:**
- velge mappe eller filer
- avvise ikke-støttede filtyper tidlig
- vise lokal stagingstatus, feil og importresultat
- hindre import uten admin-tilgang

**Viktigste beslutning:** brukeren skal kunne avgjøre om valgte filer er klare
til import.

**Retningslinje:** importflaten skal bare eie inntak og bekreftelse. Den skal
ikke bli en QC-, video- eller ortofoto-workbench. Video og ortofoto må holdes
som egne prosesseringsspor til de har egne kontrakter.

## Kontrakt: Fotoinspektør

**Primærjobb:** vurdere ett valgt bilde med nok kontekst til å stole på eller
korrigere metadata, analyse og posisjon.

**Sekundæroppgaver:**
- bla til forrige/neste bilde i relevant bildesett
- se bilde, analyse, nøkkelmetadata og kartutsnitt samtidig
- godkjenne eller reberegne analyse når admin-tilgang finnes
- redigere høyde, retning, pitch, manuell QC, målpunkt, tags og notat

**Viktigste beslutning:** brukeren skal kunne avgjøre om bildet er ferdig
godkjent, trenger manuell QC, eller har feil metadata/posisjon.

**Retningslinje:** fotoinspektoren er beslutningsflaten for ett bilde.
Massehandlinger, import og overordnet søk hører ikke hjemme her.

## Prioriterte uklarheter

1. **Kart og fotoinspektør deler for mye state og ansvar.** `App.tsx` eier
   både kartvalg, valgt foto, fullskjermsvisning, metadataredigering og
   analysehandlinger. Dette gjør det vanskelig å se hvor kartslutt og
   inspektørstart går.
2. **Import og andre mediespor har tydelig brukerflate, men uklare grenser mot
   video og ortofoto.** Import v1 er avgrenset til bilder, mens UI-et allerede
   må forklare at video og ortofoto krever egne løyper.
3. **Album og kart bruker samme bildeutvalg ulikt.** Kartet er filtrert på
   år/sesong og geografisk relevans, mens albumet laster og filtrerer
   bildesamlingen mer som et arkiv. Dette er riktig, men forskjellen bør være
   bevisst i copy, URL-state og tomtilstander.
4. **Designsystem-epicen eier struktur, men skjermkontraktene eier mening.**
   Token-, layout- og komponentarbeid må ikke erstatte beslutningen om hva
   hver flate faktisk skal hjelpe bonden med.
5. **Fotoinspektør mangler egen komponentgrense.** Det er vanskelig å teste og
   iterere fotoinspektøren uavhengig mens den ligger inline i `App.tsx`.

## Anbefalte små issues

### 1. Ekstraher fotoinspektør som egen container

Problem: fotoinspektøren er beslutningsflaten for ett bilde, men ligger inline
i `App.tsx` sammen med app-shell og kartstate.

Aksept:
- `PhotoInspector` eller tilsvarende container eier visning, strip,
  analysekort, metadatakort og kartutsnitt.
- `App.tsx` sender bare valgt bilde, navigation-sett, adminstatus og handlers.
- Eksisterende bildevisning, metadataredigering og kartutsnitt oppfører seg likt
  etter flyttingen.

Validering: `cd apps/web-app && npm run build`, pluss manuell åpning av
fotoinspektør fra kart og album.

### 2. Lag tomtilstandstekster som forklarer kart vs album

Problem: når filter eller lasting gir null bilder, må brukeren forstå om
problemet er geografisk/filterbasert eller om samlingen faktisk er tom.

Aksept:
- Kartets tomtilstand peker på år/sesong/kartfilter.
- Albumets tomtilstand peker på søk, år/sesong-token og lastestatus.
- Tekstene bruker samme begreper som dette notatet.

Validering: frontend build og visuell sjekk av kart/album med tomt filter.

### 3. Skriv importcopy som hardt avgrenser bildeimport v1

Problem: Import-flaten må forklare at v1 tar bilder, mens video og ortofoto er
egne spor. Ellers kan brukeren tolke deaktiverte filer som feil.

Aksept:
- Importflaten sier eksplisitt at JPG/JPEG/TIF/TIFF er støttet i v1.
- Video og ortofoto nevnes som egne prosesseringsløyper, ikke som manglende
  filer i samme import.
- Feil og suksessmeldinger peker på staging/finalize-status.

Validering: frontend build og manuell staging av støttet/ikke-støttet filtype.

### 4. Knytt DS-v2-regler til skjermkontrakter

Problem: design-systemarbeidet kan gi konsistente komponenter uten at flatene
blir mer selvforklarende.

Aksept:
- `docs/design-system-v2-token-v0.md` lenker til dette notatet.
- Nye UI-endringer i M2 skal oppgi hvilken skjermkontrakt de forbedrer.
- Minst ett DS-v2-pilotpunkt peker på Kart, Album, Import eller
  Fotoinspektør som faktisk brukerflate.

Validering: docs-diff og PR-beskrivelse.

## Status for M2

#189 kan lukkes når dette notatet er merged og lenket fra issue-kommentar.
M2 kan ikke lukkes samtidig fordi #148 fortsatt trenger en konkret
App.tsx/container-slice, og #31 fortsatt eier designsystem-epicen.
