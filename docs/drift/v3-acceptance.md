# V3: akseptansegrunnlag

Kontrollert 5. oktober 2026. GitHub #339 er autoritativ plan; dette dokumentet
samler bevis og gjenstående porter, ikke en ny oppgavekø. Produksjonsleveranse
eller full måloppnåelse er ikke bekreftet.

| Krav | Bevis / gjenstående port |
| --- | --- |
| To reelle datoer og kilder fra biblioteket | Jorde 4 31. mars / separat august-r13 2. august lastes på desktop og 390×844. Synkroniserte utsnitt, tilbake/frem, manglende valg og bilde er nettleserprøvd. Se v3-verification.md. |
| Kilde, materialtype og dekning | Visuell preview er merket. Transparens og registrerte begrensninger vises; bbox er ikke full gyldighetsdekning. Skråfoto lover ikke samme motiv. |
| Korrekt native rasterprøve | Verifisert august-TIFF med SHA256, CRS og transform; API-prøve gir canonical og 441 gyldige piksler i ett vindu. Gjentatt prøve gir identisk resultat; API oppgir egen algoritmeversjon for native og preview. Spring original gir 503. Se v3-source-audit.md. |
| Samme punkt over to datoer | Ikke ferdig bevist: vårens originalraster mangler, og registrering mellom datoene er ikke målt. Ingen tallfestet endringsscore. |
| Vær mellom datoene og sesong | Adapter/gate/aggregat/UI prøvd med merkede syntetiske Frost-responser. År til dato (UTC), valgfritt intervall, daglig og akkumulert tilgjengelig nedbør, månedssummer og dekning er nettleserprøvd. Ekte klienttilgang, valgt serie og stasjonsegnethet mangler. Testdata er ikke sesongmålinger. |
| Eksisterende feltobservasjoner | Faktisk eiendom og observasjonstid/offset brukes. Tom tilstand prøvd med previewdata, positiv periodefiltrering med merket fixture. Ukjent bildetilknytning er synlig. |
| Ingen avlingsprognose | UI skiller visuell/RGB-prøve og værkontekst fra agronomisk konklusjon. Ingen avlingsscore eller regn-basert diagnose. |
| Reviewbar neste versjon | Draft PR #341. Lokale repo-kontroller og isolert stack smoke består på dfaf687; GitHub-run 37333879799 består på dfaf687. Ny sesongvisning og algoritmeversjon består full lokal validate + isolert stack smoke; CI på neste commit må bekreftes separat. |
| Faktisk bruk på mobil / felt | 390×844 er nettleserprøve. Henrys fysiske prøve og produktaksept gjenstår. |

## Eksisterende friksjon

#297 er fortsatt åpen: dfaf687-buildens hoved-JS er 1 889 203 byte, gårdens GLB
6 504 036 byte. `settings-page.tsx` importerer `PropertyHero3D` statisk, og
`property-hero-3d.tsx` importerer model-viewer. Eldre påstand i #298 om en bevart
lazy-grense er derfor ikke bekreftet i denne koden. Filstørrelser er ikke en
måling av faktisk first-load waterfall eller mobilhastighet.

#297/#298 avgrenses som eget ytelsesarbeid: målt waterfall og begrunnet lazy-
grense kreves før splitting/assetendring; V3-sammenligningen skal ikke erklære
problemet løst ved å skjule buildvarselet. Valgt 3D-uttrykk beholdes inntil en
målt forbedring og fallback er prøvd.

#243 er ikke live-retestet i denne leveransen. Koden har synlig soilStatus både
på kartlaget og i innstillinger, men dette beviser ikke NIBIO-dekning, korrekt
WMS-respons eller status ved tomme/feilende tiles. Jordsmonn brukes ikke som
beregnet grunnlag i denne sammenligningen. Saken holdes separat åpen; det er
ikke bevis for at laget fungerer i felt.

## Henrys prøve før produksjonsvalg

1. Åpne Bibliotek → Ortofoto → Sammenlign og prøv jorde 4 mot august-r13.
2. Panorer/zoom, bytt dato/kilde og gå tilbake; vurder om flyten hjelper å finne
   samme område og om hull/skjøter er forståelige på fysisk mobil.
3. Gjenta med vanlige bilder og kontroller at ulikt motiv ikke forveksles med
   geometrisk justerte opptak.
4. Når originalene og Frost-tilgang finnes: verifiser kilder, perioder og
   målinger før reelt vær aktiveres. Formuler deretter ett konkret neste
   analysebehov fra faktisk bruk.
