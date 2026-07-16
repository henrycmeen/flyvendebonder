# Compliance og retention v1

## Formål og status

Dette er Flyvendebønders operative minimum for dataflyter som kan inneholde bilder, video, presis posisjon, eiendomsdata eller brukeraktivitet. Dokumentet er en teknisk styringsregel, ikke en juridisk godkjenning av et konkret behandlingsformål.

Prinsippet er enkelt: samle inn minst mulig, bruk data til et uttrykkelig formål, begrens tilgangen, og slett eller revurder data når formålet opphører. Personvernforordningen artikkel 5 beskriver dataminimering og lagringsbegrensning, og Datatilsynet anbefaler at programvaren vurderer mengde, detaljnivå, lagringstid, automatisk sletting og tilgang som del av innebygd personvern.

## Sjekkliste for nye funksjoner

Alle nye issues som innfører eller endrer en dataflyt skal svare på:

1. **Formål:** Hvilket konkret brukerbehov krever dataene?
2. **Dataminimering:** Hvilke felt/filer er nødvendige, og hva velger vi å ikke lagre?
3. **Lagringssted og kopier:** Database, filsystem, cache, eksport, backup og ekstern provider.
4. **Retention:** Hvilken hendelse starter fristen, hvor lenge beholdes data, og hvordan slettes eller revurderes de?
5. **Tilgang:** Hvem kan lese, endre, eksportere og slette? Uautorisert tilgang skal ikke lekke at data finnes.
6. **Sporbarhet:** Hvilke administrative hendelser må kunne etterprøves uten å logge rådata, hemmeligheter eller unødvendig presis lokasjon?
7. **Rettigheter og feil:** Hvordan håndteres innsyn, retting, sletting, eksport, providerfeil og delvis sletting?
8. **Validering:** Test både normalflyt, avvist tilgang, utløpt data og sletting på tvers av database og filer.

Hvis funksjonen ikke oppretter en ny dataflyt, skal issuet si dette og begrunne hvorfor.

## Operativ retention-matrise

| Datatype | Formål og minimering | Tilgang | Policy | Håndheving v1 |
| --- | --- | --- | --- | --- |
| Backendlogger | Feilsøking og driftsbevis. Logg request-ID, rute, status og varighet; ikke body, cookie, access code, rå media eller provider-secret. | Admin-/driftsflate med tjenstlig behov. | Aktiv fil på maks 20 MiB og 14 roterte filer. Månedlig kontroll skal slette eldre logger som ikke lenger trengs; hendelsesuttrekk lagres separat bare så lenge saken er aktiv. | Størrelse/antall håndheves av `RotatingFileHandler`; tidsbasert kontroll er manuell. |
| Debug bundles | Kortvarig hendelsesdiagnose. Inneholder bare whitelistet miljøinfo, avgrensede logghaler og repo-/runtimefakta. | Operatør med konkret feilsøkingsbehov. Aldri offentlig issue/PR uten manuell redaksjon. | Slett senest 7 dager etter generering, eller straks hendelsen er ferdig undersøkt. | Hver bundle inneholder `privacy-notice.txt`; sletting er foreløpig manuell. |
| Media-staging | Midlertidig mottak før bilde-/videoimport. Ikke en permanent mediebank. | API-rutene krever adminsesjon og tjenestelaget filtrerer på dagens bruker-ID og eiendom. Den generiske asset-ruten avviser stagingområdet. Sikker request-identitet og medlemskap er måltilstanden i GitHub issue 250. | Slett rå stagingfiler senest 24 timer etter vellykket finalize, eller 7 dager etter avbrutt/feilet staging. Foreldreløse stagingmapper uten databasejobb vurderes etter mappens `mtime` og slettes når de er eldre enn 7 dager. | Retention er definert, men ikke automatisk håndhevet. Full tilgangskontroll er heller ikke levert. |
| Direkte videojobb | Stabil jobb-/reviewkontrakt. Direkte endepunkt lagrer ikke råvideo. | Tjenestelaget filtrerer på dagens bruker-ID og jobb/eiendom. Sikker request-identitet og medlemskap er måltilstanden i GitHub issue 250. | Metadata, review og avledede artefakter: 90 dager etter siste oppdatering eller tidligere brukersletting. | Retention er definert, men ikke automatisk håndhevet. Full tilgangskontroll er heller ikke levert. |
| Bilder og geodata knyttet til felt/flyging | Produktets dokumentasjon og historikk. Behold original proveniens, men ikke flere kopier enn nødvendig. | Felt-/eiendomstilgang; samme beslutning for metadata, fil og eksport. | Behold mens felt-/flygingshistorikken er aktiv. Ved bruker-/eiendomssletting må database, filer, avledede artefakter og søkeindekser slettes eller anonymiseres samlet. Årlig nødvendighetsvurdering inntil selvbetjent lifecycle finnes. | Tilgang finnes delvis; samlet lifecycle/sletting må kartlegges og håndheves. |
| Provider-cache og kildesnapshot | Reproduserbar kildekontekst. Lagre normalisert svar/proveniens, ikke credentials eller komplette leverandørresponser uten behov. | Samme tilgang som arbeidsobjektet snapshotet gjelder. | Providerens dokumenterte cachefrist eller prosjektets kortere frist. Uforanderlige evidenssnapshots følger arbeidsobjektets retention. | Må defineres per provider før aktivering. |

Periodene er standarder for dagens private pilot. Nytt rettslig, kontraktsmessig eller dokumentert produktbehov kan endre en periode, men issuet må da oppgi begrunnelse, eier og slettemekanisme.

## Logging og audit

- Applikasjonslogger skal være diagnostiske, ikke en sekundær database.
- Logg aldri opplastet filinnhold, koordinatlister, cookies, access codes, API-nøkler eller rå providerpayload.
- Administrative endringer i tilgang, deling, retention og sletting skal etter hvert få et minimalt revisjonsspor med aktør, handling, arbeidsobjekt, tidspunkt og resultat.
- Et revisjonsspor skal ikke beholde den slettede nyttelasten. Ved sletting er det nok å dokumentere type, intern referanse, tidspunkt, resultat og eventuell policybegrunnelse.
- Debug bundles er konfidensielle driftsartefakter. Miljøsnapshotet bruker en eksplisitt allowlist av ufarlige runtimefelt; credentials og tilkoblingsstrenger skal ikke tas med. Operatøren må fortsatt kontrollere `backend-tail.txt` og `logs-api.json` før deling.

## Sletteregel

En sletting er ikke ferdig før alle kjente kopier er håndtert:

1. autoriser og avgrens arbeidsobjektet
2. identifiser databaseposter, filer, avledede artefakter, staging og cache
3. tilby dry-run for driftsjobber som kan slette flere objekter
4. slett transaksjonelt eller marker delvis feil eksplisitt
5. skriv et minimert revisjonsresultat uten rådata
6. verifiser at API-er og filendepunkter ikke lenger kan hente objektet

Produksjonssletting skal ikke kjøres manuelt av en agent uten eksplisitt godkjenning og en verifisert backup-/recovery-plan.

## Kjente håndhevingsgap

- Media-staging og videojobber mangler en avgrenset cleanup-/delete-mekanisme som rydder både database og filer.
- Request-identitet, medlemskap og konsekvent route-isolasjon er ikke ferdig; dette spores i GitHub issue 250.
- Backendlogger har størrelse-/antallsrotasjon, men ikke tidsbasert sletting eller automatisert kontroll av sensitivt innhold.
- Debug bundles merkes med slettfrist, men gamle arkiver ryddes ikke automatisk.
- Bilder, flight captures, processingartefakter og eksportfiler mangler én samlet lifecycle-/sletteflyt på tvers av database og filsystem.

Disse gapene skal bli konkrete GitHub-issues med egen validering; de skal ikke skjules som fritekst-TODO-er i produksjonskode.

## Kilder

- Personvernforordningen artikkel 5: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679
- Datatilsynet, programvareutvikling med innebygd personvern: https://www.datatilsynet.no/rettigheter-og-plikter/virksomhetenes-plikter/programvareutvikling-med-innebygd-personvern/krav/
- Datatilsynet, lagringsbegrensning: https://www.datatilsynet.no/rettigheter-og-plikter/personvernprinsippene/grunnleggende-personvernprinsipper/lagringsbegrensning/

## Opphav

- GitHub issue: 28
- Første operative baseline: 2026-07-16
