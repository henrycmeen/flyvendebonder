# Flyvendebønder V2: bibliotek, opptak og import

## Mål
Et shadcn-basert komponentgrunnlag med et konsistent liquid/glass-uttrykk. Behold 3D-gården, og gjør opptaksdato, bildeutvalg og import forståelig og sporbar.

## Akseptanse
- Knapper, fokus og glassflater bruker felles komponenter og tokens. Shadcn-konfigurasjon er eksplisitt og kompatibel med eksisterende Tailwind 3.
- Mediebibliotek viser opptaksdato, grupperer og sorterer bilder, har søk og QC-filter og oppgir når visningen bare omfatter innlastede bilder.
- Henry valgte 30. september liquid-panelet på 15190 som designgrunnlag og presiserte at arbeidet skal rydde opp uten å komplisere appen. Samme glass, farger, årsknapper og årstidsikoner beholdes. En enkel horisontal datorekke viser faktiske opptaksdager og bildeantall inne i panelet. Alle datoer og valgt dag bruker eksisterende URL-scope; den kompakte velgeren viser valgt dato. Lukket innhold er inert, Escape beholder eller gjenoppretter fokus etter hvor brukeren er, og smale skjermer har begrenset panelhøyde.
- Bibliotekutvalget kan åpnes som kronologisk bildesekvens med synlig opptakstid, manuell navigasjon og eksplisitt avspilling/pause. Ufullstendig utvalg og ukjent tidssone oppgis; lasting og feil stopper framdrift. Dialoglukking returnerer fokus til åpneknappen.
- Filvalg bevarer relative kildebaner, viser størrelser og avvisninger, støtter fjerning og unngår lokale duplikater.
- Opplasting og endelig import er to synlige steg. Jobbkvitteringer kan gjenfinnes etter refresh; filvise feil og duplikater skjules ikke av en overordnet fullført-status.
- Backend validerer kildebaner før lagring, begrenser varig lagring til 256 MiB per fil / 1 GiB per jobb, og rydder kun eget nye jobbkatalog ved avbrutt opplasting. Originale filnavn bevares som metadata.
- Eksisterende kart og 3D-visning fungerer. Relevante tester, prosjektvalidering, stack smoke, visuell kontroll, uavhengig review og CI er grønne før main.

## Avgrensning og publisering
Dette er første sammenhengende V2-leveranse. Browserimporten støtter bilder; video og bilder uten nødvendig geometri krever fortsatt eksisterende eller senere arbeidsflyter. Filstørrelsesgrensene gjelder varig lagring etter multipart-parsing; ingress/spooling trenger separat driftsgrense. Søking og filtrering i biblioteket er eksplisitt begrenset til innlastede bilder.

V2 forhåndsvises med isolerte data på Mac mini. Bredt redesign publiseres etter at Henry har sett det konkrete resultatet og godkjent publisering. Den tidligere godkjenningen gjelder ferdig kontrollerte små kart-/innstillingsrettelser.

## Fluid Functionalism — videreføring 5. oktober 2026
Referansene er [Surfaces](https://www.fluidfunctionalism.com/docs/surfaces) og [Button](https://www.fluidfunctionalism.com/docs/button), visuelt undersøkt i nettleser. Referansens hovedknapp ble målt til 36 px høyde, 13 px tekst og 8 px radius. Vi bruker prinsippene i eksisterende shadcn/Radix-komponenter, med minst 44 px trykkhøyde på mobil.

- Hierarki: én hevet glassflate for mobilmeny og filter, roligere grupper inni flaten.
- Gruppering: år i fast rutenett; årstider som enkle valg; opptaksdager beholder synlig dato og antall.
- Konsistens: felles knappestørrelser, felt, faner og hjørner. Mer bruker kompakte rader med ikon og tekst.
- Respons: hover/trykk endrer farge uten skalering eller flyttende markering. Tastaturfokus og reduced motion beholdes.

Ingen ny avhengighet eller registry-kode er hentet inn. Kartet, bildene og 3D-gården beholdes. Kontrollert ved 320/375 px mobil og 1440 px desktop; kartfilterets åpne/lukke-forløp, menynavigasjon, innstillingsfaner og bredde. Prosjektvalidering og isolert stack-smoke på 8814/5214 består. Dette er lokal V2-forhåndsvisning.
