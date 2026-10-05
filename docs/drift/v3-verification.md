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
