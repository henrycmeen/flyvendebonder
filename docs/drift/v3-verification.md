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

Eksisterende manifeststier til originalraster er ikke verifisert på dagens
lagring. Et 5 cm GeoTIFF funnet i eksportene har andre dimensjoner/rammer enn
augustmanifestet; det er ikke koblet inn automatisk. Originaltilgang returnerer
utilgjengelig fremfor stille preview-fallback. UI viser webforhåndsvisningens
begrensning. Korrekt native CRS/affin prøvetaking er ikke alene bevis på
registrering mellom datoer, radiometrisk kalibrering eller avlingsnytte.

Vær-API har eier-/eiendomskontroll og returnerer utilgjengelig inntil Frost-kilde
og serie er vurdert og tilkoblet. Beregningskontrakten er testet med fixtures,
men dette er ingen levert værserie. Før aktivering trengs adapter, kilde/perioder
synlig i UI og godkjent stasjon/serie. Feltobservasjoner i sammenligningen gjenstår.

Eksisterende bundlevarsel (ca. 1,88 MB / 548 kB gzip) gjenstår i #297.
