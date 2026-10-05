# V3: sammenlign opptak og vis grunnlaget

## Beslutning 5. oktober 2026

Henrys bestilling og rapporten «Undersøk Flyvendebønder piloten» gir tre
resultater: finne og sammenligne opptak, etterprøve rastergrunnlaget og vise
historisk vær/feltobservasjoner som kontekst. GitHub #339 eier rekkefølgen;
#337, #338 og #340 eier leveransene. Ingen ny infoside eller flymotor.

Rapportreferanse: https://chatgpt.com/c/6ac3a54d-b6dc-83eb-951e-7b9e4d35677d
Den tilgjengelige samtalelesingen var avkortet til 20 000 tegn. Kodefunnene
verifiseres i repoet; rapportens øvrige bransjepåstander er ikke implementeringskrav.

## Første brukerflyt

Bibliotek → sammenlign → velg to datoer og bilder/ortofoto → se samme
geografiske utsnitt når georefereringen tillater det → gå tilbake med valg bevart.
Vanlige dronebilder gir visuell sammenligning uten påstått pikseljustering.
Første ortofotopar er jorde 4 den 31. mars og det større augustopptaket
2. august 2026. Overlappende rammer er ikke bevis på faktisk dekning eller
identiske opptaksforhold. Transparens og ukjent dekning må være synlig.

Forventede feilforløp: ingen andre datoer, ingen kilde, manglende bilde,
ingen geografisk overlapp, ugyldige rasterdata og utdatert URL-valg.
Mobil bruker store bilder uten å skjule datovalget eller sperre tilbakeknappen.

## Rasterfunn

Bekreftet i kildeversjon e0892a6: kanoniske rasterprøver brukte lineær
interpolasjon innenfor geografiske rammer og PIL, uten GeoTIFF-CRS og
geotransform. Manglende original kunne gi automatisk preview-fallback.
V3 skal transformere posisjonen til rasterets CRS, bruke affin invers og
gyldighetsmasker, samt returnere kilde og prøvens utstrekning. Preview må
velges eksplisitt og merkes som omtrentlig. RGB-verdier er ikke avling eller
kalibrert vegetasjonsindeks; ulikt lys/GSD/prosessering hindrer enkle datodeltaer.

## Sesongvær er en egen kontrakt

`weather-season-v1` utvider ikke feltfunn-snapshotet i
`weather-context-contract-v1.md`. Sesongserien bevarer faktiske UTC-måleperioder
og kildens referansedatoer; disse er ikke nødvendigvis gårdens kalenderdøgn.
Nedbør P1D med PT6H dekker vanligvis foregående 06Z til referansedatoens 06Z;
PT0H døgn dekker referansedatoens midnatt til neste midnatt. Offset skal ikke
legges til en referansetid som allerede inneholder observasjonstid.

Normalisert aggregat godtar ett vurdert kilde-/serievalg per element, én
24-timersperiode per verdi og kvalitetskode 0. Kode 1 kan inneholde korrigerte
eller interpolerte verdier og krever senere eksplisitt støtte. Ugyldige verdier,
konflikter, alternative sensorer og overlappende perioder blir hull.
En dokumentert Frost-verdi -1 for ingen nedbør skal normaliseres til 0 i en
senere provider-adapter, med råverdi bevart i provenance; andre negative verdier
avvises. Summen av tilgjengelige verdier er adskilt fra komplett periodesum.

## Konkret kildeavhengighet

Ingen konfigurert Frost-klient-ID ble påvist i prosjektets konfigurasjon eller
live `.env` ved navne-/tilstedeværelsessjekk 5. oktober. Ingen credentialverdi
ble lest ut eller flyttet og ingen autentisert kildeforespørsel ble gjort.
Det finnes heller ikke et godkjent stasjons-/serievalg for Meen gård.
Vær vises derfor som utilgjengelig; V3 viser ikke oppdiktet regnsum.

Før aktivering må #340 få ett begrenset, reproduserbart datakall, valgt stasjon
og sensor/serie per element, avstand/høyde/periodedekning, offset/oppløsning,
kvalitet, lisens/attribusjon og cachepolicy. Registrering av klient-ID og live
aktivering håndteres separat. Ingen nærmeste-stasjon-heuristikk eller normal-
sammenligning aktiveres uten dette grunnlaget. Bildearbeidsflyten skal fungere
selv om værkilden mangler.

Offisielle kilder kontrollert 5. oktober 2026:

- https://frost.met.no/howto.html
- https://frost.met.no/authentication.html
- https://frost.met.no/concepts2.html
- https://frost.met.no/dataclarifications.html

## Verifikasjon

Eksisterende rastertester utvides med projisert/rotert raster, maskert no-data
og eksplisitt preview. Sesongaggregat testes mot kjent regnsum, tørr dag,
manglende/avviste døgn, tvetydige/overlappende perioder og feil kilde/serie.
Frontend testes med ekte manifestvalg og ugyldige URL-/bildetilstander.
Repoets `validate-agent-worktree.sh` og isolerte `run-stack-smoke.sh` er
påkrevd før PR, sammen med mobil/desktop-kontroll og uavhengig review.
Henry prøver arbeidsflyten før produksjonsvalg og neste analysefunksjon.
