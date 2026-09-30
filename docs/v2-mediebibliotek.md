# Flyvendebønder V2: bibliotek, opptak og import

## Mål
Et shadcn-basert komponentgrunnlag med et konsistent liquid/glass-uttrykk. Behold 3D-gården, og gjør opptaksdato, bildeutvalg og import forståelig og sporbar.

## Akseptanse
- Knapper, fokus og glassflater bruker felles komponenter og tokens. Shadcn-konfigurasjon er eksplisitt og kompatibel med eksisterende Tailwind 3.
- Mediebibliotek viser opptaksdato, grupperer og sorterer bilder, har søk og QC-filter og oppgir når visningen bare omfatter innlastede bilder.
- Opptakstidslinjen beholder et lekent glassuttrykk: synlig skinne med årstidsfargede perler, valgt halo og direkte datovalg. Den viser faktiske datoer og bildeantall, med års-/sesongvalg og tydelig alle/valgt-dato-scope. Tastatur og smal skjerm fungerer.
- Bibliotekutvalget kan åpnes som kronologisk bildesekvens med synlig opptakstid, manuell navigasjon og eksplisitt avspilling/pause. Ufullstendig utvalg og ukjent tidssone oppgis; lasting og feil stopper framdrift. Dialoglukking returnerer fokus til åpneknappen.
- Filvalg bevarer relative kildebaner, viser størrelser og avvisninger, støtter fjerning og unngår lokale duplikater.
- Opplasting og endelig import er to synlige steg. Jobbkvitteringer kan gjenfinnes etter refresh; filvise feil og duplikater skjules ikke av en overordnet fullført-status.
- Backend validerer kildebaner før lagring, begrenser varig lagring til 256 MiB per fil / 1 GiB per jobb, og rydder kun eget nye jobbkatalog ved avbrutt opplasting. Originale filnavn bevares som metadata.
- Eksisterende kart og 3D-visning fungerer. Relevante tester, prosjektvalidering, stack smoke, visuell kontroll, uavhengig review og CI er grønne før main.

## Avgrensning og publisering
Dette er første sammenhengende V2-leveranse. Browserimporten støtter bilder; video og bilder uten nødvendig geometri krever fortsatt eksisterende eller senere arbeidsflyter. Filstørrelsesgrensene gjelder varig lagring etter multipart-parsing; ingress/spooling trenger separat driftsgrense. Søking og filtrering i biblioteket er eksplisitt begrenset til innlastede bilder.

V2 forhåndsvises med isolerte data på Mac mini. Bredt redesign publiseres etter at Henry har sett det konkrete resultatet og godkjent publisering. Den tidligere godkjenningen gjelder ferdig kontrollerte små kart-/innstillingsrettelser.
