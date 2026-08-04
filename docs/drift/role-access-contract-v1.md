# Rolle- og tilgangskontrakt v1

## Formål og status

Denne kontrakten beskriver første modell for trygg tilgang til gårder, felt,
scouting-funn og rapporter. Den er styrende for implementasjonen i GitHub issue
250, men innfører ikke i seg selv flerbrukerinnlogging eller offentlig deling.

Modellen er capability-basert: roller gir et øvre sett med tillatelser, mens
gårdsmedlemskap og eventuell objektdeling avgjør hvor tillatelsene gjelder.
Tilgang skal være `default deny`, og alle arbeidsobjekter skal tilhøre nøyaktig
én gård.

## Begreper

- **Identitet:** brukeren som er autentisert for den aktuelle requesten.
- **Gård:** tenant og sikkerhetsgrense for eiendommer, felt og tilhørende data.
- **Medlemskap:** koblingen mellom identitet, gård, rolle og status.
- **Rolle:** et navngitt maksimum av capabilities; rollen alene gir ikke
  tilgang til en annen gård eller et annet objekt.
- **Capability:** en konkret handling, for eksempel `finding.write`.
- **Delingstilordning:** eksplisitt tilgang til et avgrenset objekt for et
  aktivt eksternt medlemskap. Tilordningen kan aldri utvide rollen.

Dagens globale admin-kode er bare en midlertidig pilotmekanisme. Den er ikke en
rollemodell og skal ikke brukes som identitet når flerbrukertilgangen bygges.
Den private pilotinstallasjonen kan eksplisitt bruke `ADMIN_ACCESS_OPEN=true`;
da bindes alle requests til den konfigurerte piloteieren uten passord. Dette er
et driftsunntak for en enkeltbrukerinstallasjon, ikke anonym deling i rollemodellen,
og skal ikke aktiveres i en delt eller flerbrukerinstallasjon.

## Roller

V1 bruker fire stabile roller. Produktord som «kunde», «medhjelper» og
«rådgiver» beskriver relasjonen til gården, men skal ikke bli nye roller når
samme capability-sett er tilstrekkelig.

| Rolle | Hensikt | Tilgangsomfang |
| --- | --- | --- |
| `owner` | Eier eller gårdsadministrator | Hele gården; kan administrere medlemskap og deling. Minst ett aktivt eiermedlemskap skal alltid finnes. |
| `operator` | Ansatt eller medhjelper i driften | Alle operative felt, funn og rapporter i gården; kan ikke administrere medlemmer, gård eller deling. |
| `advisor` | Ekstern rådgiver som bidrar faglig | Bare eksplisitt delte objekter; kan lese grunnlag og registrere/redigere funn, men ikke endre feltgrenser eller publisere på vegne av gården. |
| `viewer` | Kunde, mottaker eller annen leser | Bare eksplisitt delte objekter og bare lesing. Eksport krever en egen tilordning. |

En bruker kan ha forskjellige roller i forskjellige gårder. Et medlemskap skal
ha status `invited`, `active`, `revoked` eller `expired`; bare `active` gir
tilgang. Invitasjoner og brukergrensesnitt for dem kommer i en senere slice.

## Capability-matrise

`ja` betyr at rollen kan få handlingen i sitt tilgangsomfang. `delt` betyr at
et aktivt medlemskap i tillegg trenger en eksplisitt delingstilordning til
objektet. `nei` kan ikke overstyres av en delingstilordning.

| Capability | `owner` | `operator` | `advisor` | `viewer` |
| --- | --- | --- | --- | --- |
| `field.read` | ja | ja | delt | delt |
| `field.write` | ja | ja | nei | nei |
| `finding.read` | ja | ja | delt | delt |
| `finding.write` | ja | ja | delt | nei |
| `report.read` | ja | ja | delt | delt |
| `report.write` | ja | ja | nei | nei |
| `report.export` | ja | ja | delt | delt |
| `share.manage` | ja | nei | nei | nei |
| `member.manage` | ja | nei | nei | nei |
| `farm.manage` | ja | nei | nei | nei |

Sletting og arkivering er ikke en implisitt del av `write`. Destruktive
capabilities skal navngis og vurderes separat når lifecycle-flyten bygges.
`owner` skal heller ikke kunne hoppe over retention-, audit- eller
bekreftelsesregler for sletting.

## Objekter og delingsnivå

Alle felt, funn og rapporter har `farm_id`, og underordnede objekter skal
valideres mot samme gård som forelderen. En ID fra en annen gård må aldri bli
gyldig bare fordi den sendes sammen med en gård brukeren har tilgang til.

V1 skiller mellom disse synlighetsnivåene:

1. **Privat:** standard for nye objekter. Bare `owner` og `operator` i gården
   kan bruke sine rolle-capabilities.
2. **Delt:** én eller flere aktive `advisor`-/`viewer`-medlemmer får eksplisitte
   capabilities til et felt, funn eller en rapport. Tilgangen er skjæringen
   mellom rolle, medlemskap og delingstilordning.
3. **Offentlig:** ikke støttet i V1. Ingen anonym lenke, søkemotorindeksering
   eller offentlig asset-URL skal oppstå ved å sette et felt i databasen.

Et felt kan deles med valgte underobjekttyper, men dette skal lagres eksplisitt;
deling av feltet betyr ikke automatisk eksport eller tilgang til all historikk.
Direkte deling av et funn eller en rapport kan eksponere et minimalt
foreldresammendrag, som feltnavn og nødvendig kartavgrensning, men ikke andre
funn, rapporter, bilder eller gårdsdata.

En delt rapport kan inneholde eksplisitt valgte nøkkelbilder. `report.read` gir
da avledet lesetilgang til nøyaktig de thumbnail-/web-assetene som inngår i den
autoriserte rapporten. `report.export` gir tilgang til de representasjonene som
faktisk inngår i rapporteksporten, men aldri automatisk til rå originalfiler,
søskenbilder eller resten av et album. Asset-ruten skal autorisere via rapport,
gård, aktivt medlemskap og deling for hver request; den skal ikke gjøre en
rapportdeling om til en offentlig eller langtlevende asset-URL. Tilbakekalling
av rapporttilgangen stopper også denne avledede asset-tilgangen umiddelbart.

«Kundedelt» og «rådgiverdelt» er derfor ikke egne globale synlighetsnivåer:
de er aktive medlemskap med henholdsvis `viewer` eller `advisor`, kombinert med
eksplisitte objekttilordninger.

## Beslutningsregel for hver request

Backend skal evaluere tilgang i denne rekkefølgen:

1. autentiser request-identiteten; manglende eller utløpt identitet gir `401`
2. løs aktivt medlemskap, rolle og `farm_id`; manglende gårdstilgang gir ikke
   innsyn i noen objekt-ID-er
3. bygg objektoppslaget med tenant-scope og, for `advisor`/`viewer`, en aktiv
   delingstilordning som minst gjør objektet synlig
4. hent objektet bare innenfor dette samlede tilgangsscope-et; intet treff gir
   `404` uansett om objektet finnes utenfor scopet
5. kontroller at rollen og den konkrete delingstilordningen tillater den
   forespurte capability-en
6. kontroller objektstatus, retention og andre handlingsspesifikke regler
7. utfør handlingen og skriv minimert audit-hendelse når handlingen er sensitiv

Direkte oppslag av et objekt utenfor brukerens tenant- eller delingsscope skal
svare som om objektet ikke finnes (`404`). Det gjelder også et eksisterende,
men udelt objekt i en gård der en `advisor` eller `viewer` er medlem. `403`
brukes bare når objektet allerede er synlig for brukeren, men den forespurte
handlingen mangler capability. En skrive- eller eksporttilordning må derfor også
gjøre samme objekt lesbart; den skal ikke skape et skjult «write only»-objekt.
Lister skal filtreres i databasespørringen, ikke hentes bredt og filtreres i
frontend eller Python etterpå.

Backend er autoritativ. Frontend kan skjule utilgjengelige handlinger, men det
er bare brukerhjelp og aldri et sikkerhetstiltak. Ved `401` eller tenant-avvisning
skal klienten fjerne privat state før den viser neste steg.

## Deling, tilbakekalling og audit

- Bare `owner` med `share.manage` kan opprette eller endre en
  delingstilordning.
- Deling skal navngi mottaker, objekt, capabilities, oppretter, opprettet
  tidspunkt og valgfri utløpstid; rå access tokens skal ikke logges.
- Tilbakekalling av medlemskap eller deling gjelder umiddelbart for nye
  requests og skal også gjøre fremtidige asset-/eksportkall ugyldige.
- Deling skal aldri kopiere private data til et offentlig filområde.
- Opprettelse, endring, tilbakekalling, avvist tilgang og privilegert eksport
  får et minimert revisjonsspor med aktør, handling, objekttype/-referanse,
  tidspunkt og resultat.
- Audit-sporet skal følge retention-reglene og skal ikke inneholde rapporttekst,
  koordinatlister, bilder, cookies eller credentials.

## Trinnvis implementasjon

Kontrakten kan leveres uten et stort systembytte:

1. **Route- og identitetsgrunnlag (#250):** dokumentert offentlig allowlist,
   request-identitet, gårdsmedlemskap og trygg bootstrap for dagens eier.
2. **Tenant-isolasjon (#250):** scope alle databaseoppslag og asset-/eksportkall,
   med automatiske tester for to brukere og to gårder.
3. **Rolle-capabilities:** innfør matrisen over i én sentral policyfunksjon og
   migrer rutene fra generisk admin-sjekk.
4. **Objektdeling:** delingstilordninger, tilbakekalling og audit for felt, funn
   og rapporter; start backend-first med fixtures og avvist-tilgangstester.
5. **Produktflate:** liten eierstyrt medlems-/delingsflate og forståelige
   tom-, utløpt- og tilgang-nektet-tilstander.

Hvert steg skal være deploybart, beholde default-deny og ha negative tester.
Offentlige lenker, SSO, organisasjonskatalog og avansert delegering krever egne
produkt- og sikkerhetsbeslutninger senere.

### Medlemskapsgrunnlag og bootstrap

Første schema-slice under #250 innfører `Farm`, `FarmMembership` og en obligatorisk
`farm_id` på eksisterende eiendommer, men beholder `Property.user_id` og dagens
ruteadferd inntil request-identitet og tenant-scope er klare.

Migreringen oppretter én gård per eksisterende property-eier, legger alle denne
eierens properties i samme gård og oppretter ett aktivt `owner`-medlemskap.
Brukere uten properties får ikke en tom gård av backfillen. Startup-seeding
oppretter manglende pilotmedlemskap idempotent, men må aldri reaktivere eller
oppgradere et medlemskap som er eksplisitt tilbakekalt eller endret senere.

Før produksjonsdeploy skal dagens SQLite-database få en konsistent, tidsstemplet
backup. Teknisk rollback er kode-rollback sammen med Alembic-downgrade til
`20260716_17`; downgraden fjerner bare det nye medlemskapsgrunnlaget og beholder
de eksisterende property-radene og deres `user_id`. Etter at senere slicer har
begynt å håndheve medlemskap i rutene, skal schemaet ikke nedgraderes uten en
samordnet rollback av kode og en verifisert databasebackup.

### Sesjonsbundet pilotidentitet

Første identitetsslice etter medlemskapsgrunnlaget binder nye signerte
adminsesjoner til én intern `user_id`. Access code, navn, kontaktdata og andre
personopplysninger skal ikke ligge i cookien. Innloggingen er fortsatt en
single-admin pilotflyt: identiteten må være en aktiv `owner`, ellers avvises
innloggingen som feilkonfigurert. `ADMIN_USER_ID` kan binde piloten eksplisitt
til en stabil intern ID. Uten denne innstillingen
brukes den eneste aktive eieren; flere aktive eiere krever eksplisitt ID.
Visningsnavnet kan endres uten at identiteten eller seeding flyttes til en ny
bruker. Automatisk bootstrap er bare tillatt i en tom brukerdatabase. Hvis
brukere finnes uten aktiv eier, feiler seeding lukket slik at tilbakekalt
tilgang ikke kan gjenoppstå som en ny standardbruker.

Cookieformat v1 manglet brukeridentitet og godtas derfor ikke etter overgangen;
eksisterende nettlesere må logge inn på nytt. Dette krever ingen datamigrering.
Privat profilvisning og profilendringer bruker den sesjonsbundne brukeren og
avvises hvis brukeren mangler eller owner-medlemskapet er tilbakekalt. Andre
domener flyttes fra global pilotbruker til request-identitet i senere, egne
slicer under #250; denne overgangen skal ikke tolkes som full route-isolasjon.
Hvis admin-tilgang deaktiveres, ignoreres og slettes eksisterende cookies også
for leseruter, slik at privat profilinformasjon ikke forblir tilgjengelig.

### Sesjonsbundet operativ skrivetilgang

Neste identitetsslice binder alle eksisterende sesjonsbeskyttede operative
ruter til `user_id` i den signerte adminsesjonen. Det gjelder felt, planlegging,
funn, oppdrag, captures, processing, bildehandlinger, import, media, video,
assets og backendlogger. Objektoppslag og foreldrekoblinger blir filtrert i
databasespørringen; en ID som tilhører en annen pilot-eier gir `404`.
Vedlikeholdsendepunkter som fortsatt tar `user_id` som parameter avviser en
annen ID enn sesjonsidentiteten med `403`.

`ingest_runs` får en obligatorisk eier og kan bare leses eller kobles til
processing-artefakter av samme sesjonsbruker. Bildehash-deduplisering skjer
per bruker, slik at samme bildefil aldri gjenbruker eller røper en annen
brukers `photo_id`. De underliggende derivatfilene kan være innholdslike, men
hver bruker får sitt eget autoriserbare foto- og assetobjekt. Migreringen utleder eier fra
tilknyttede bilder, bilde-assets eller processing-captures. En historisk
kjøring uten slike koblinger kan bare legges til den eneste aktive eieren;
tvetydige kjøringer eller flere mulige fallback-eiere stopper migreringen før
schemaet endres. Teknisk rollback er kode-rollback sammen med
Alembic-downgrade til `20260716_18`, etter verifisert databasebackup. Hvis to
brukere allerede har importert samme bildefil etter deploy, stopper hash-
downgraden før DDL; da skal den verifiserte pre-deploy-backupen gjenopprettes.

Backendlogger er systemglobale og er derfor et eksplisitt unntak fra vanlig
tenant-scope. Bare identiteten som er konfigurert som pilotadministrator kan
lese dem; et annet aktivt eiermedlemskap er ikke tilstrekkelig.

### Routekontrakt etter default-deny-slicen

Den offentlige allowlisten er uttømmende:

| Metode | Rute | Formål | Data |
| --- | --- | --- | --- |
| `GET` | `/api/v1/health` | lastbalanserer og driftssjekk | tjenestestatus og tidspunkt |
| `GET` | `/api/v1/admin/session` | avklare om innlogging er konfigurert/aktiv | boolsk status og eventuell utløpstid |
| `POST` | `/api/v1/admin/login` | opprette signert, brukerbundet sesjon | sesjonsstatus; cookie er `HttpOnly` |
| `POST` | `/api/v1/admin/logout` | slette sesjonscookie | sesjonsstatus |

Alle andre API-ruter, også profil, kartkilder, ortofotoanalyse, gårdsdata,
felt, bilder, planlegging, rapporter, eksport, assets, import, media og video,
krever en gyldig sesjon og et aktivt eiermedlemskap. Ressursoppslag bruker
sesjonsbrukeren i databasespørringen; eksplisitt `user_id` kan ikke overstyre
sesjonsidentiteten. `/api/v1/logs` har i tillegg pilotadministrator-krav.

Kildeguarden i `test_default_deny_routes.py` gjør nye ruter private som
standard: en rute uten request-bundet eieravhengighet må legges eksplisitt i
den korte offentlige listen. Klienten starter ingen privat bootstrap før
sesjonen er bekreftet, viser en egen innloggingsport og tømmer privat state og
API-cache ved avvist identitet.

### Kjørbar capability-policy

Rolle-/capability-matrisen er implementert sentralt i
`app/services/access_control.py`. Policyen skiller mellom gårdsomfattende
tilgang og tilgang som krever en eksplisitt objektdeling. Ukjente roller,
ukjente capabilities og alle medlemskap uten status `active` avvises
fail-closed. En delingsavhengig capability er alltid avvist når kalleren ikke
gir en eksplisitt, matchende grant.

Første integrasjon erstatter den lokale `owner`/`operator`-listen ved valg av
skrivbar gård med policyoppslaget for `field.write`. `POST /fields` og
`PATCH /fields/{field_id}` håndhever i tillegg `field.write` mot gården til den
konkrete eiendommen eller feltressursen. Manglende medlemskap, utilstrekkelig
rolle og inaktivt medlemskap gir samme `404` som en ukjent ressurs. Legacy
`Property.user_id` er derfor ikke autoritativt for disse mutasjonene.

Kildeguarden i `test_access_control.py` hindrer nye flerrolle-matriser i
API-laget og krever eksplisitt capability-guard i de to feltrutene. Dette er
fortsatt bare policygrunnlaget; full gårdsscoping av øvrige bruker-eide ruter
og persistente objektdelinger leveres som egne slicer før `advisor` og `viewer`
kan få produktmessig tilgang.

## Testkontrakt

Implementasjonen skal minst bevise:

- uautentiserte ruter er avvist utenfor en kort, dokumentert allowlist
- bruker A kan ikke lese, endre, eksportere eller gjette objekter i gård B
- alle fire roller følger capability-matrisen for normalflyt og avvisning
- `advisor` og `viewer` ser bare eksplisitt delte objekter
- et eksisterende, men udelt objekt gir samme `404` som en ukjent objekt-ID
- rapportlesing åpner bare rapportens eksplisitte nøkkelbilde-assets; direkte
  oppslag av søskenbilder gir `404`, og tilbakekalling stopper asset-tilgangen
- utløpt eller tilbakekalt medlemskap/deling stopper API, assets og eksport
- foreldrekoblinger kan ikke brukes til å krysse gårdsgrensen
- frontend rydder privat state ved utløpt identitet eller tenant-avvisning

Testene skal bruke syntetiske brukere og gårder. Produksjonssmoke skal bare
bekrefte allowlist og avvisning og må ikke skrive eller skrive ut private data.

## Compliance

Modellen følger `docs/drift/compliance-retention-v1.md`: minst mulig data,
samme tilgangsbeslutning for metadata, filer og eksport, og ingen
eksistenslekkasje på tvers av gårder. En implementasjonsissue som lagrer
invitasjoner, medlemskap eller audit må beskrive formål, retention,
slettemekanisme og kjente kopier før merge.

## Opphav

- GitHub issue: 194
- Implementasjonsspor: GitHub issue 250
- Første kontrakt: 2026-07-16
- Første rutehåndheving: GitHub issue 273
