# V3 kandidat: verifikasjon 5. oktober 2026

Status: lokal, reviewbar kandidat. Ikke merget eller publisert. #339 er samlet mål;
#337 og #338 har første implementasjon, #340 er fortsatt en kildeavhengighet.

## Automatiske kontroller

- `./scripts/validate-agent-worktree.sh`: PASS, 313 backendtester, frontendtester,
  lint og produksjonsbuild. Logg på Mac mini: `/tmp/flyvendebonder-v3-validation.log`.
- `./scripts/run-stack-smoke.sh`: PASS med isolert backend 8826 og frontend 5202.
  Logg: `/tmp/flyvendebonder-v3-smoke.log`. Første forsøk stoppet fordi 5201 var
  opptatt; ingen eksisterende tjeneste ble overtatt.
- Etter siste forenkling av etiketter og kontroller: frontendtester, lint og build
  kjørt på nytt. Logg på kontrollmaskinen: `/tmp/flyvendebonder-v3-final-frontend.log`.
- Uavhengig lesende review av raster, tilgang, værkontrakt og sammenligningsflyt.

## Nettleserprøve

Mac mini-preview 5200 / backend 8825 bruker en isolert SQLite-kopi og egne
web-/thumbnailfiler. Produksjonsdatabase, originaler, tjenester og secrets er
ikke endret. Utvalget med lokale bildefiler dekker vår/august 2026; eldre poster
kan derfor gi manglende bilder i denne previewen.

Prøvd ved desktop og 390 x 844:

- Ortofoto jorde 4 31. mars og august 2. august 2026 lastes og kan panoreres
  sammen innen manifestenes geografiske overlapp.
- Mobil har to store bilder stablet, datovalg og synlig dock, uten horisontal
  dokumentoverflyt. Ingen +/- zoomkontroller.
- Vanlige dronebilder 2. august / 31. mars lastes i 1600 x 900 weboppløsning.
  De presenteres som separate foto, uten påstand om geometrisk registrering.
- Datobytte, lukk/åpne, browser tilbake/frem og gammel URL med manglende kilde
  gir bevarte valg eller en gjenopprettbar manglende-tilstand.
- Manglende bildefil gir forståelig feil på den aktuelle siden; den andre siden
  fungerer fortsatt.

Dette er en nettleserprøve ved mobil viewport, ikke fysisk feltaksept.

## Begrensninger før videre analyse

Vårens originalraster mangler på de gamle manifeststiene. August-r13 er nå
registrert som et separat produkt, etter kontroll av faktisk SHA256, CRS,
transform og dimensjoner (se v3-source-audit.md). Den erstatter ikke det gamle
augustmanifestet. Originaltilgang feiler tydelig fremfor stille preview-fallback.
Korrekt native prøvetaking beviser ikke registrering mellom datoer, radiometrisk
kalibrering eller avlingsnytte.

Vær-API har eier-/eiendomskontroll og returnerer utilgjengelig inntil Frost-kilde
og serie er vurdert og tilkoblet. Beregningskontrakten er testet med fixtures,
men dette er ingen levert værserie. Adapter, kilde-/periodevisning og eksisterende feltobservasjoner er nå
implementert. Godkjent stasjon/serie og autentisert live-kall gjenstår.

Eksisterende bundlevarsel (ca. 1,88 MB / 548 kB gzip) gjenstår i #297.


## Oppfølgende integrasjon

- 70 målrettede tester for Frost, eiendomsgate, sesongaggregat og raster bestått.
- Full kontroll: 362 backendtester, frontendtester, lint og build bestått.
  `/tmp/flyvendebonder-v3-context-validation.log` på Mac mini.
- Uavhengig lesende review fant ingen blokkerende funn i Frost/eiendom,
  observasjonsdatoer eller stale state. Live provider var ikke del av review.
- Preview viser faktisk tom observasjonstilstand (0 i valgt periode), kilde,
  ukjent bildetilknytning og utilgjengelig vær. Ingen syntetiske værverdier er
  presentert som faktiske målinger. Positiv værvisning er nå også prøvd med isolerte, tydelig merkede testdata (se nedenfor).
- Relative GeoTIFF-stier løses nå fra manifestmappen, ikke prosessens arbeidsmappe.
- Ny smoke ble startet på egne porter etter at tidligere portvalg var opptatt;
  eksisterende tjenester ble ikke overtatt.

- Oppfølgende stack smoke på 8840/5227: PASS. Logg `/tmp/flyvendebonder-v3-context-smoke.log`; beholdt isolert state `v3-integration/context-smoke-r3`.
- Ny kontekstvisning prøvd ved 390 x 844: dokumentbredde 390 px, ingen horisontal overflyt.


## Positiv kontekstprøve med syntetiske data

En egen kopi av preview-databasen, `v3-integration/browser-fixture.db`, brukes
av midlertidig backend 8860 og frontend 5240. Ingen produksjonsdata eller ordinær
preview-database er endret. Provider-responser går gjennom `httpx.MockTransport`
og den vanlige Frost-normaliseringen, eiendomsgaten og sesongaggregatet. Ingen
live værforespørsel eller credential brukes. Kilde og observasjon er merket
TESTDATA. Server og fane stenges etter prøve.

Input: nedbør -1 og 5 mm, temperatur 12 og 14 °C, bare to referansedatoer. En
syntetisk feltobservasjon er registrert 10. mai 2026 kl. 10:00 +02:00.

Observerte resultater i desktop og 390×844:

- Vår–august: 5 mm, 13 °C, 2 av 125 døgn og tydelig ufullstendig dekning.
- 31. mars–1. april: 5 mm, 13 °C og 2 av 2 døgn; mai-observasjonen vises ikke.
- Bytte tilbake til lang periode gir 2 av 125 døgn og én observasjon igjen.
- Gamle resultater fjernes og lasting vises mens valgt periode endres.
- UTC-periodene er ulike for nedbør PT6H og temperatur PT0H. Nedbørens råverdi
  -1 bevares og forklares som kildens ingen-nedbør-verdi, vist som 0 mm.
- Serienøkkelen er tilgjengelig i en egen teknisk detalj. Manglende døgn er
  eksplisitte hull, ikke nullmålinger. Observasjonens kilde, tid, offset og
  ukjente bildetilknytning vises.
- Mobil dokumentbredde er 390 px, også med åpne værdetaljer.

Reproduksjonsinput og midlertidig harness på kontrollmaskinen:
`work/v3-context/browser-fixture.py`. Bilder: `v3-weather-fixture-mobile.png`
og `v3-weather-fixture-desktop.png` i samme mappe. Prøven beviser positiv
applikasjonsflyt med disse inputene; den godkjenner ingen virkelig stasjon,
provider-tilgang eller agronomisk bruk.

Etter forenkling av tekniske etiketter: full validate består på nytt, logg
`/tmp/flyvendebonder-v3-positive-ui-validation.log`. GitHub CI på e84ee46 består:
backend-python39, validate og stack-smoke, run 37330333076.

## August-r13: faktisk kilde og integrasjon

- Originalhash samsvarer med leveransen; preview er avledet fra den eksakte TIFF-en.
- API på isolert backend 8825 gir canonical EPSG:32632, 20 358 × 21 862 og 441 av 441 gyldige piksler ved 59.173828 / 9.670614. Dette er ett punkt, ikke full dekning.
- Samme API gir 503 for vårens jorde 4 uten eksplisitt preview-valg.
- Ny sammenligning velger jorde 4 og Augusteksport · 5 cm · r13; eksisterende URL-valg bevares.
- Begge bilder lastes på desktop og mobil. Kildebegrensninger, dimensjoner og hash vises i detaljer. Dokumentbredde 390 px også med originaldetaljer åpne.
- Full validate + stack smoke før siste vedlikeholdsretting: PASS, /tmp/flyvendebonder-v3-r13-validation.log.

- Sluttkontroll etter regenereringsretting: full validate + isolert stack smoke PASS, logg `/tmp/flyvendebonder-v3-r13-final-validation.log`. 362 backendtester, frontendtester, lint og build. Uavhengig review bekrefter at registrert preview ikke kan kollidere med et annet produkts output; ugyldige felt stoppes før builder/mutasjon. Eksisterende CLI-test prøver bevaring, ID-kollisjon og feilforløp med uendrede filer.

## Sesongvisning og prøvens algoritmeversjon

En separat fixture `browser-season-fixture.db` og harness
`work/v3-context/browser-season-fixture.py` prøver de samme syntetiske
Frost-responsene gjennom normalisering/gate/aggregat. Ingen live værdata.

Observerte UI-resultater 5. oktober 2026:

- År til dato: 1. januar–5. oktober UTC, 5 mm tilgjengelig sum, 13 °C,
  2 av 278 døgn. Januar har 2/31 døgn; måneder uten målinger viser Mangler,
  oktober er merket del av måned (0/5 valgte døgn).
- Tilpasset 31. mars–1. april: 2/2 døgn, 5 mm og 13 °C. Mars har målt
  0 mm (1/1 valgt døgn), april 5 mm (1/1); begge er del av måned.
- Valgte ortofoto forblir jorde 4 31. mars / august-r13 2. august.
  Feltobservasjonen følger fortsatt opptaksdatoene, ikke den separate værperioden.
- Daglige stolper og akkumulert tilgjengelig nedbør vises. Manglende
  døgn gir hull i kurven; ingen målinger blir gjort om til null.
- 390×844 dokumentbredde/scrollbredde er begge 390 px med åpne graf- og
  kildedetaljer. Bilder: `v3-season-fixture-mobile.png` og
  `v3-season-fixture-desktop.png` i kontrollmaskinens `work/v3-context`.
- Dagens dato og validering bruker UTC som API-et. Fixture dekker Oslo
  rett etter lokal midnatt. Skjema validerer faktisk innsendte datofelt,
  også når native date/autofill ikke oppdaterer React-draft før submit.
- Uavhengig slutt-review: ingen gjenstående blokkere i UTC/FormData-rettingen.

To identiske prøver fra det faktiske august-TIFF-et returnerer 441 gyldige
piksler og samme RGB-statistikk ved 59.173828 / 9.670614. Responsen inkluderer
`native-crs-affine-rgb-v1`; eksplisitt preview har `preview-wgs84-rgb-v1`.
Dette versjonerer prøvemetoden, ikke radiometrisk kalibrering eller avlingsnytte.
Bevisinput/resultat: `work/v3-context/v3-r13-repeat.json`.

Sluttkontroll: full validate + isolert stack smoke PASS, 362 backendtester,
frontendtester (inkludert weather-series), lint og build. Logg på Mac mini:
`/tmp/flyvendebonder-v3-season-final-validation.log`. Midlertidige
fixture-servere 8860/5240 og smoke-servere 8840/5227 er stoppet etter prøven.

## Utsatt 3D og første lasting

Full lokal validate + isolert stack smoke består etter utsatt renderer/GLB,
inkludert 362 backendtester, frontendtester, lint og build. Logg på Mac mini:
/tmp/flyvendebonder-v3-lazy-final-validation.log. Uavhengig review av tre
komponentfiler fant ingen gjenstående blokkere. Browser feilprøver for
utilgjengelig WebGL2 og blokkert modellfil beholder illustrert SVG.
Normal settings- og mobilmenymodell beholder kamerautsnitt og lastes først
ved synlig behov. Se v3-first-load.md for målte bytes og begrensninger.
CI på ed9f7b5: run 37336581908 er grønn. Neste commit kontrolleres separat.

## Gjeldende API-kontrakt med reelt raster

På ec43870 ble isolert backend 8825 prøvd med lokal testautentisering:
august-r13 returnerer 200, source.algorithm_version=native-crs-affine-rgb-v1,
canonical EPSG:32632, originalens dimensjoner/affine transform og 441/441
gyldige piksler. Jorde 4 vår returnerer 503 uten eksplisitt preview-valg.
Bevis: work/v3-context/v3-current-raster-api.json på kontrollmaskinen.
Ingen produksjonsdata eller provider-konfigurasjon endret.


## Reelt vær etter kildeavklaring

5. oktober 2026: offentlig seKlima-transport har egen provideridentitet, fast
endepunkt, ingen auth eller automatisk fallback, og samme strenge serie- og
kvalitetskontroll. Uavhengig review verifiserte direkte MET-responser og fant
ingen blokkere. Eksisterende/utvidede værtester består (69). Autentisert
GET på isolert 8825 /api/v1/weather/season?start=2026-03-31&end=2026-08-02
ga 200/available, SN30255:0, 125/125 for begge elementer, 260,4 mm,
12,944 °C og null avviste observasjoner. Rårespons er bevart separat som
v3-real-weather-api.json i kontrollmaskinens work/v3-context.

IAB ved desktop og 390×844 viste 260,4 mm, 12,9 °C og siste godkjente
referansedato 2. august. Kildedetaljer viste Porsgrunn–Ås, 9,7 km,
stasjonsbegrensning og faktisk UTC-periode; kildehenvisningen er MET seKlima.
Mobilbredde/scrollbredde var 390/390 også med utvidet nedbørskurve.
Månedssummer var mars 0 (1 valgt døgn), april 83,5, mai 31,4, juni 94,6,
juli 50,9 og august 0 (2 valgte døgn), totalt 260,4 mm.
Dette er faktiske stasjonsmålinger og en nettleserprøve, ikke fysisk feltaksept.
Se v3-weather-source.md for kilde, eksakte serier, lisens og aktivering.

## Sted først i fotografisk sammenligning, 6. oktober 2026

Endret etter Henrys avvisning av dato-først-flyten. Eksisterende frontendtest
utvidet med nærhet, numerisk eiendom, ulike datoer, deterministisk rangering,
view-target versus kamera-GPS, kjente vinkelavvik, nadir/yaw og confidence.
Uavhengig read-only review fant tre P2 som er rettet: proxy-målpunkt,
samme dato ved bytte av utgangspunkt og undefined scope i URL. Ny review
fant ingen gjenværende blokkere.

Full validate-agent-worktree.sh --with-stack-smoke består: backendtester,
frontendtester, lint/build og isolert stack smoke på 8840/5227. Logg:
/tmp/v3-place-validation.log på Mac mini; isolert smoke-state:
/Volumes/Projects/Active/Flyvendebonder/runtime-caches/worktrees/v3-place-smoke-20261006.

IAB desktop og 390x844 bekreftet at det gamle paret
20260401122945-0085 / 20260403115935-0166 avvises som et ikke-kvalifisert par.
Bytte til den andre datoens bilde velger en annen dato, lukking skriver
ikke undefined scope, tilbake/frem gjenoppretter utgangspunktet, og mobil
har bredde/scrollbredde 390/390. Ortofoto åpner fortsatt mars/august med
synkroniserte utsnitt. Skjermbilder på kontrollmaskinen:
work/v3-context/v3-place-desktop.png og v3-place-mobile.png.

Faktisk metadata-par 20240803192809-0068 / 20250708104754-0001 har 6,67 m
mellom estimated-målpunkter, rapportert confidence 0,8 og kompatibel retning;
UI viser 7 m. Begge bildefiler gir imidlertid 404 i preview. Derfor er dette
bevis for valg/rangering, ikke visuell motivaksept. Se akseptansedokumentet
for begrensningen i historiske previewfiler. Henrys neste produktaksept og
produksjonsvalg gjenstår.

## Bildevisning desktop/mobil, 6. oktober 2026

Bildet har nå egen viewportflate med fast toppverktøylinje (dato, detaljer,
redigering, lukk) og kompakt bildestripe i egen rad. Bildetrykk lukker ikke
visningen. Detaljer starter lukket ved hver åpning og vises på siden på
bred skjerm, nederst på smal skjerm. Redigering holder detaljene åpne.
Dialogsemantikk, innledende lukkefokus, Tab-fangst og fokusretur er prøvd.
Eksisterende ArrowLeft/Right og Escape brukes fortsatt.

IAB på desktop og 390x844: bildebytte, åpne/skjule detaljer, åpne/avslutte
redigering uten dataskriving, lukking, ny åpning og tastatur er prøvd.
Utvidede detaljer ved 320x740, 768x900, 1024x768 og 1440x900: ingen
horisontal overflyt; lukk har 44x44 trefflate og ligger innen viewport.
Bildet bruker contain og beskjæres ikke. Det lille Leaflet-kartet monteres
først når detaljer vises (0 kart skjult, 1 kart synlig med positiv størrelse),
etter ett rettet P2 fra uavhengig review. Ny review fant ingen blokkere.
Skjermbilder på kontrollmaskinen: work/v3-context/v3-viewer-desktop.png og
v3-viewer-mobile.png. Dette er nettleserprøve, ikke fysisk mobilaksept.

Full validate-agent-worktree.sh --with-stack-smoke består etter rettelsen:
369 backendtester, frontendtester, lint, build og isolert smoke 8840/5227.
Logg /tmp/v3-viewer-validation.log; smoke-state under prosjektets eksterne
runtime-caches/worktrees/v3-viewer-smoke-20261006. Ingen produksjonsendring.


## UI-gjennomgang 6. oktober 2026

Avgrenset layoutreparasjon etter brukerens skjermbilde av filtre over bibliotekbilder.

- Bibliotek: tett hvit filterrad i vanlig dokumentflyt; gammel sticky-regel med ugyldig bakgrunnstoken fjernet. Mobile filtre ligger fortsatt i docken, Escape lukker og fokuserer sammendraget.
- Planlegging: rullbar mobil/tablet-layout, bounded områdeliste og kart, responsiv inspektør. Header bruker flex i stedet for fast høydefradrag; alle sju verktøy beholder 44px bredde i rullbar rad.
- Innstillinger: hele siden ruller, inkludert gårdsmodellen, fanene og skjemaet. Heroen kan ikke lenger kollapse skjemaets scrollregion.
- Import: handlingsknapper kan brytes på smale skjermer. Kartlag: popover har begrenset høyde og intern rulling.
- Tokenkontroll fant manglende success-farge; den bruker nå eksisterende emerald-farge.

Kildegjennomgang omfattet navigasjon/dock, felles kontroller, planlegging, kartfiltre, innstillinger, import og skogbruk. Dormante TimelineBottom/ProfileCard er ikke aktive GUI-flater.

Kontroller: full `validate-agent-worktree.sh --with-stack-smoke` PASS (369 backendtester, frontendtester, lint, build og isolert stack-smoke), logg `/tmp/v3-ui-audit-validation.log`. Etter siste fargealias: nytt frontendbuild PASS, `/tmp/v3-ui-token-build.log`. Uavhengig lesende diffreview uten blokkerende funn.

Nettleser: 320/360/390px mobil, 844x390 liggende mobil, 1024/1280/1440/1536px desktop. Bibliotek og ortofoto, bildevisning, planlegging med valgt hovedteig, skogbruk, importens tomtilstand, innstillinger Profil/Kartlag, mobilmeny og kartfilter-toggling kontrollert. 360px: ingen horisontal dokumentoverflyt, eksportknapp nås ved rulling. 844x390: Lagre nås gjennom samlet siderulling. Kartpopover i 1280x480 holder seg innen viewport. Filopplasting, lagring av profil og destructive handlinger ble ikke utført. Ingen fysisk mobil/Safari-prøve eller produksjonsdeploy.

Skjermbilder på kontrollmaskinen: `work/v3-context/ui-audit-library.png`, `ui-audit-library-mobile.png`, `ui-audit-planning-mobile.png`.

Claude Opus, via claude-advisor, gjennomgikk den avgrensede UI-diffen. Ingen material defects i diffen; rådet om landscape-karthøyde førte til `min(24rem,50dvh)` og kart/inspektør-split fra 1400px. Tooltip er Radix Portal; områdeliste har egen min-h-0/scroll; PlanningMap har ResizeObserver/invalidateSize. Bakgrunnstoken kontrollert i levende DOM som hvit. Resterende touch-scroll på fysisk mobil er ikke verifisert.

Oppfølging etter Claude: PlanningMap hadde også en intern 22rem minimumshøyde; denne er fjernet så parenten eier kartets størrelse. Fersk nettleserprøve 844x390 viser både kart og parent 234px og lastede Leaflet-tiles. 1440px har kart/detaljer ved siden av hverandre. tsc, fokusert ESLint på begge planning-komponenter og nytt produksjonsbuild PASS, `/tmp/v3-ui-claude-build.log`.

## Bibliotekfane for sammenligning, 6. oktober 2026

Sammenlign er nå tredje fane i Bibliotek, ved siden av Bilder og Ortofoto. Den viser en egen sammenligningsflate i stedet for å legge verktøyet over/foran grid og filtre. Bilder/Ortofoto returnerer til vanlig grid. Eksisterende comparison-URL-parametre og utvalg beholdes; fersk innlasting gjenoppretter aktiv fane. Mobilens bildefiltre avmonteres i sammenligning og kommer tilbake ved Bilder. Pagineringens IntersectionObserver kobles til aktuell sentinel ved retur til grid.

Nettleserprøve: foto- og ortofotosammenligning, retur til grid, mobil390px uten horisontal overflyt og URL-innlasting med aktiv Sammenlign. Skjermbilde `work/v3-context/library-comparison-tab.png` på kontrollmaskinen. Full validering og stack-smoke: `/tmp/v3-library-tabs-validation.log`.

### Comparison options in the mobile dock — 6 October 2026

Comparison date, source, property and nearby-photo choices now reuse ResponsivePageControls above the mobile navigation. Desktop choices stay inline. Initial photo selection remains in the image grid; comparison results and context remain in the page.

Browser checks: photo anchor selection; orthophoto date/source changes; dock toggle and Escape; 320 px mobile without horizontal overflow and 44 px select targets; 390 px mobile; 1440 px desktop inline controls; return between library tabs. Screenshot: controller work/v3-context/comparison-dock-mobile.png.

Required validation including isolated stack smoke passed: /tmp/v3-comparison-dock-validation.log (369 backend tests, frontend tests, lint and production build). Preview only; no production deployment.

### UI stability and comparison polish — 6 October 2026

Comparison options have quieter grouped date/source fields, 44 px rounded controls and a near-opaque dock with reduced blur. Only a short opacity/transform entrance animates, with reduced-motion support; map/layout dimensions are not animated.

Corrected three independent UI defects: comparison maps now depend on source URL/bounds primitives rather than freshly allocated image objects; desktop viewer only reserves the metadata column when details are visible; sidebar pointer hover and keyboard focus are tracked separately.

Browser evidence: zoomed orthophoto layer dimensions stayed 1175×608 and 1676×1801 across desktop→390 px mobile transition. Viewer closed-details grid used 1424 px single column, then two columns with details; mobile remained a 374 px single column. Mobile routes checked: library, comparison, settings profile/map/admin, planning, forest and import; no horizontal document overflow in checked states. Screenshot: controller work/v3-context/comparison-dock-polished.png. Local missing historical thumbnails are preview-data errors, not claimed repaired.

Full required validation and isolated stack smoke passed: /tmp/v3-ui-stability-validation.log. No production deployment.

### Shadcn-inspired library controls — 6 October 2026

Reference reviewed: official shadcn Radix Tabs and Native Select documentation, including the rendered Native Select page. Existing React/Radix components were reused; no dependency or framework change.

Library navigation now uses controlled Radix Tabs with manually activated keyboard navigation and a labelled active panel. Inactive hover cannot look selected, and the library tabs switch without colour/background interpolation. Library filters and comparison choices use the same 44 px native select component. Visible labels align the first and second choices; date options use compact Norwegian dates so the year remains visible at 320 px. Image captions retain full dates.

Mobile page controls use a controlled, labelled disclosure inside the existing dock surface. Closing preserves mounted controls and current selections; Escape returns focus to the trigger. The closed comparison row summarises chosen dates. Comparison fields use two restrained columns, and photo matching details are expandable. Redundant comparison heading is visually hidden; results remain in the page. Removed obsolete comparison styling and separate nested card backgrounds.

Browser checks on preview 5200: 1280 px desktop image grid and inline filters; 390 px dock filters and orthophoto/photo comparison; 320 px comparison with document width equal to viewport. ArrowRight on Bilder kept it selected until Enter activated Ortofoto. A quality selection survived Escape/close/reopen and reset correctly. Changing the first orthophoto date updated the caption and remained selected after closing. Both comparison types and return to the image grid were checked. Controller screenshot: work/v3-context/shadcn-library-mobile.png.

Full required validation including isolated stack smoke passed: /tmp/v3-shadcn-validation.log. Final frontend lint/build after text and hover refinements: /tmp/v3-shadcn-final-frontend.log. Existing large-chunk build warning remains. Browser viewport checks are not a physical iPhone/Safari performance test. Preview only; no production deployment.
