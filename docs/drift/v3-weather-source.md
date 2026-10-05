# V3: offentlig historisk værkilde

Kontrollert 5. oktober 2026. Dette er en kildevurdering for sesongkontekst i lokal
V3-kandidat. Stasjonsmålingene gjelder stasjonen og er ikke målt på jordet.
Ingen produksjonskonfigurasjon er endret.

## Kilde og faktisk transport

METs [seKlima](https://seklima.met.no/) publiserer sin API-base i
[frontend.properties](https://seklima.met.no/frontend.properties):
`https://rim.k8s.met.no/api/v1`. Frontendens observasjonskall bruker
`/observations?sources=SN30255&referenceTime=2026-03-31/2026-08-03&elements=…&timeResolution=days`.
Begge elementer ga HTTP 200 uten konto, auth-header, cookie eller client ID.
Dette er en offentlig frontendtransport med Frost-observasjonsskjema, ikke en
publisert kontrakt om langsiktig stabilitet for et separat tredjeparts-API.
Endepunktet er derfor fast, eksplisitt valgt og uten automatisk fallback.
[Frosts ordinære API krever client ID](https://frost.met.no/howto.html).

API-responsen oppgir [CC BY 3.0 Norge](https://creativecommons.org/licenses/by/3.0/no/).
Kandidatens kildefelt skiller «seKlima public API (Frost observation schema)» fra
«Frost v0» og bevarer endepunkt, hentetid, responsens `createdAt`, `apiVersion`,
`license`, `totalItemCount` og forespurt halvåpent referansedatointervall.
Hver verdi beholder sensor/serie, element, råverdi, kvalitetskode, offset,
oppløsning, nivå og performance/exposure-kategorier.

## Valgt stasjon og dekning

Stasjon: **SN30255:0, PORSGRUNN - ÅS**, MET.NO, WMO 1462.
[Offentlig stasjonsliste](https://rim.k8s.met.no/api/v1/activestations) oppgir
WGS84 59.0872 / 9.6603 og 100 moh. Haversine-avstand fra Meen-punktet
59.173828 / 9.670614 er 9651 meter (avrundet). Jordets høyde og høydeforskjellen
er ikke verifisert. Stasjonen er vurdert som egnet for nærliggende
sesongkontekst, med eksplisitt begrensning for lokale byger, terreng og mikroklima;
den begrunner ingen jordfuktighet, avlingsprognose eller behandling.

| Element | Verifiserte referansedatoer | Kvalitet | Fast identitet |
| --- | --- | --- | --- |
| Døgnnedbør | 125/125, 31. mars–2. august 2026 | Alle kode 0 | `sum(precipitation_amount P1D)`, mm, PT6H, serie 0, uten nivå; performance C, exposure 2 |
| Døgnmiddeltemperatur | 125/125, samme periode | Alle kode 0 | `mean(air_temperature P1D)`, degC, PT0H, serie 0, høyde over bakken 2 m; performance C, exposure 1 |

Øvre API-grense er eksklusiv: `2026-08-02` returnerte kun til 1. august;
`2026-08-03` inkluderte 2. august. Verdiene bruker leverandørens referansedatoer,
og faktiske måleperioder beholdes per verdi. [METs dataavklaringer](https://frost.met.no/dataclarifications.html)
og [periodebegreper](https://frost.met.no/concepts2.html) gjelder observasjonsskjemaet.

Nærmeste stasjon SN30285 Skien–Borgeåsen (1139 m, 75 moh) har nedbør, men ingen
publisert temperaturserie. NIBIO SN30330 Gjerpen–Århus (7936 m, 41 moh) har begge,
men temperaturens performance er E og én nedbørverdi var kode 1. Valgt MET-stasjon
har komplett kode-0-dekning for begge elementer og krever ikke blanding av stasjoner.

## Aktivering og begrensninger

`historical_weather_provider` er eksplisitt `frost` (standard) eller `seklima`.
`frost_weather_enabled` er fortsatt false som standard; eiendommen må ha et
review med approved, dato, avstand, navn, egnethetsnotat og eksakte selections.
Ingen automatisk stasjonsvalg, erstatning av manglende målinger eller fallback.
Frost beholder sin client ID-gate; offentlig seKlima sender ingen auth.
Kvalitet 1 eller høyere er fortsatt hull, ikke null nedbør.

Dekningen over er kontrollert med direkte GET-kall og oppsummering av faktisk
respons, ikke en fixture eller nåværende værmelding. En direkte kjøring av kandidatens `property_weather` på Mac mini med samme
review 5. oktober 2026 kl. 21:20:54–55 UTC ga `available`, 125/125 dager for
begge elementer, 0 avviste observasjoner, 260,4 mm observert sum og 12,944 °C
middel. Responsene oppga apiVersion v0 og totalItemCount 125 hver.
Dette er en faktisk integrert serviceprøve; HTTP-ruting og frontendaksept
dokumenteres separat av integrasjonsansvarlig.
