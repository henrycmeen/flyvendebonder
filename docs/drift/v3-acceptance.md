# V3: akseptansegrunnlag

Oppdatert 6. oktober 2026. GitHub #339 er autoritativ plan; dette dokumentet
samler bevis og gjenstående porter, ikke en ny oppgavekø. Produksjonsleveranse
eller full måloppnåelse er ikke bekreftet.

| Krav | Bevis / gjenstående port |
| --- | --- |
| To reelle datoer og kilder fra biblioteket | Jorde 4 31. mars / separat august-r13 2. august lastes på desktop og 390×844. Synkroniserte utsnitt, tilbake/frem, manglende valg og bilde er nettleserprøvd. Se v3-verification.md. |
| Kilde, materialtype og dekning | Visuell preview er merket. Transparens og registrerte begrensninger vises; bbox er ikke full gyldighetsdekning. Skråfoto lover ikke samme motiv. |
| Korrekt native rasterprøve | Verifisert august-TIFF med SHA256, CRS og transform; API-prøve gir canonical og 441 gyldige piksler i ett vindu. Gjentatt prøve gir identisk resultat; API oppgir egen algoritmeversjon for native og preview. Ny regenerert vår-TIFF er også prøvd via autentisert API: tre koordinater, 441 gyldige piksler per vindu i begge datoer og identiske gjentakelser. Den tapte historiske våroriginalen gir fortsatt 503. Se v3-source-audit.md. |
| Samme punkt over to datoer | Tre felles koordinater gir native prøver i den nye vår-TIFF-en og august-TIFF-en. Geometrisk registrering mellom datoene er fortsatt ikke målt. Ingen tallfestet endringsscore. |
| Vær mellom datoene og sesong | Ekte seKlima-målinger fra SN30255:0 Porsgrunn–Ås er verifisert via autentisert API og UI. 31. mars–2. august: 125/125 døgn, 260,4 mm og 12,944 °C i snitt. Stasjonen er 9,7 km unna, 100 moh; lokale avvik og ukjent jordehøyde er synlige begrensninger. Provider er eksplisitt aktivert kun i isolert preview; produksjon er ikke aktivert. Se v3-weather-source.md. |
| Eksisterende feltobservasjoner | Faktisk eiendom og observasjonstid/offset brukes. Tom tilstand prøvd med previewdata, positiv periodefiltrering med merket fixture. Ukjent bildetilknytning er synlig. |
| Ingen avlingsprognose | UI skiller visuell/RGB-prøve og værkontekst fra agronomisk konklusjon. Ingen avlingsscore eller regn-basert diagnose. |
| Reviewbar neste versjon | Draft PR #341. Ny kildeleveranse består full lokal validate med 369 backendtester, frontendkontroller, build og isolert stack smoke. Uavhengig review av værtransport og ny rasterkilde fant ingen blokkere. CI for ny commit bekreftes separat. |
| Faktisk bruk på mobil / felt | 390×844 er nettleserprøve. Henry avviste den første fotoflyten: to datoer må vise omtrent samme sted. Stedsbasert rettelse er nettleserprøvd, men ny produktaksept gjenstår. |

## Eksisterende friksjon

#297/#298 er fortsatt åpne, med målt delretting: skjult meny laster ikke
lenger model-viewer eller gårdens 6,5 MB GLB. Fersk lokal IAB/Chromium-
preview gir 52,13 % mindre encoded hoved-JS (553 430 → 264 921 B).
Normal settings-/mobilmeny beholder kamerautsnitt; merket SVG-fallback
består ved manglende WebGL2 og blokkert GLB. Ingen fysisk mobil- eller
Safari-aksept, og hoved-JS er fortsatt over 500 kB. Se v3-first-load.md.

#243 er live-retestet: de eldre NIBIO-endepunktene returnerer HTML-feil fremfor kartbilder. Ny harmonisert tjeneste har ikke tilsvarende Jordkvalitet-lag; ingen automatisk semantisk erstatning er gjort. Koden har synlig soilStatus både
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
4. Kontroller den regenererte vårkilden og værperioden i preview, og vurder om
   nærliggende stasjonsmålinger gir nyttig kontekst. Formuler deretter ett
   konkret neste analysebehov fra faktisk bruk.

## Tilbakemelding og stedsbasert fotoflyt, 6. oktober

Henrys prøve avviste dato-først-valget: det første bildet på hver dato innen
samme eiendom gir ikke nødvendigvis samme motiv. Dette er en mislykket
produktprøve, ikke aksept.

Foto starter nå med et valgt utgangspunkt. Kandidater kommer fra samme
numeriske eiendom på andre datoer, innen 30 meter og med kompatibel kjent
kameravinkel. Beregnede målpunkter brukes bare for estimated/manual;
point og ukjent modus er GPS-proxy og blandes ikke med målpunkter. Lav eller
ukjent sikkerhet vises. Nærhet er et forslag, ikke registrering av utsnitt.
Ugyldige gamle URL-par vises ikke som en sammenligning.

De 120 innlastede previewbildene har 16 utgangspunkt med kandidat. Ingen
kvalifisert par har begge datoer i 2026. Historiske sider i de fire parene
med én 2026-dato gir 404 for både bilde og thumbnail; 2026-sidene gir 200.
Dermed gjenstår positiv visuell vurdering av et fotografisk par når begge
bildefiler er tilgjengelige. Dette begrenser previewbeviset; det beviser
ikke at produksjon mangler disse filene. Ortofoto beholder sammenligning
av geografisk overlapp. Ingen automatisk bilderegistrering eller avlingsscore.
