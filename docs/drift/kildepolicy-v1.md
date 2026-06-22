# Kildepolicy v1 for kart, felt og analyse

Sist verifisert mot offisielle kilder: 2026-06-20.

Dette er beslutningstabellen for eksterne kart- og geodatakilder i Flyvendebønder. Den skiller mellom:

- primære feltkilder, som kan drive produktlogikk
- visuelle og analytiske overlay-kilder, som kan forklare kontekst
- rettighetsstyrte kilder, som ikke skal bli bred produktavhengighet uten særskilt tilgang

## Kort beslutning

- Bruk Geonorge/Kartverket sine eiendom- og teigdata som primær kilde for klikkbart feltvalg og teiggeometri.
- Bruk NIBIO jordsmonn, jordkvalitet og AR50 som overlay/analysekontekst der tjenesten er åpent tilgjengelig og kilde oppgis.
- Ikke bygg bredt distribuert feltvalg på NIBIO Gårdskart webservice/WMS, FKB-AR5 WMS eller Dyrkbar jord uten avklart Geovekst/Norge Digitalt-rettighet.
- Bruk Copernicus/Sentinel/CLMS som åpen EO-kontekst for raster, tidsserier og vegetasjonsindikatorer, ikke som kilde for juridiske teiggrenser.

## Kildematrise

| Kilde | Status | Produktrolle | Trygg bruk i Flyvendebønder | Ikke bruk til |
| --- | --- | --- | --- | --- |
| Geonorge/Kartverket Matrikkelen Eiendomskart Teig | Åpne data | Primær teig- og eiendomsgeometri | Feltvalg, punktklikk, planleggingsenheter, GeoJSON-eksport med provenance | Agronomisk klassifisering alene |
| Geonorge Eiendom REST-API | Åpent API for lokalisering | Teigoppslag fra matrikkelnummer eller punkt | Backend-klient for feltkandidater og kildefeltene `source_endpoint`, `source_fetched_at`, `source_updated_at` | Sanntidsgaranti eller grunnboksdata |
| NIBIO jordsmonn/jordkvalitet WMS/WFS | Åpent temalag etter tilgjengelig tjenestedokumentasjon | Analysekontekst og kartoverlay | Jordkvalitet, tekstur, drenering, erosjons- og jordtema der de finnes | Primær teiggrense eller eneste beslutningsgrunnlag |
| NIBIO AR50 WMS | Åpent/grovmasket arealressurs-overlay | Grov areal- og landskapskontekst | Oversikt, skog/jordbruksareal/snaumark-kontekst, senere skogsporet | Detaljert feltvalg på gårdsnivå |
| NIBIO FKB-AR5 WMS/nedlasting | Geovekst/Norge Digitalt-avgrenset | Detaljert arealressurskart | Bare intern/avklart bruk med riktig rettighet og tydelig attribusjon | Bred offentlig produktavhengighet uten avtale |
| NIBIO Dyrkbar jord | Geovekst/Norge Digitalt-avgrenset | Plan-/arealtema | Bare ved avklart rettighet | Automatisk anbefaling eller åpen distribusjon uten avtale |
| NIBIO Gårdskart webservice/WMS | Geovekst/Norge Digitalt-avgrenset | Arealtall og Gårdskart-visning for valgt gnr/bnr | Intern støtte eller visuell fallback når tilgang er avklart | Primær feltvalgskilde, siden jobId/cache og rettighet gjør dette skjørere enn Geonorge |
| Copernicus Sentinel / CLMS | Åpen og fri tilgang med kildekrav | EO/raster/analysekontekst | Tidsserier, NDVI/vegetasjonsindekser, sammenligning mot egne droneprodukter | Juridisk eiendoms-/teigkilde |

## Kildehistorie for eksisterende spor

| Spor | Nåværende GitHub-retning | Kildebeslutning |
| --- | --- | --- |
| HEN-42 / GitHub issue: 195 | Feltvalg og flyplanlegging v1 | Start fra Geonorge-teiger for faktisk feltgeometri. NIBIO jordsmonn/AR50/Gårdskart er støtte- og kontekstlag, ikke primær feltkilde. |
| HEN-52 / GitHub issues: 75 og 96 | Geonorge teiger v1 og hardening | Viderefør Geonorge Eiendom API som datalinje. Neste hardening bør handle om cache, provenance, multipolygoner og fallback. |
| HEN-17 / GitHub issue: 26 | GeoJSON/interoperabilitet | GeoJSON er vektorkontrakten for felt, polygoner og ruter. `source` og provenance skal peke tilbake til Geonorge, manuell tegning eller import. |
| HEN-55 / GitHub issue: 82 | STAC for raster- og flight-artefakter | STAC beskriver raster, ortofoto, NDVI og flight-bundles. Sentinel/CLMS og egne droneprodukter kan inngå, mens teiggrenser fortsatt ligger i GeoJSON-sporet. |
| GitHub issue: 99 | Processing/ODM/WebODM | ODM/ortofoto er egne prosesserte kilder med checksums og artifact-provenance. Bruk kildepolicyen til å skille egne produkter fra NIBIO/Geonorge overlays. |
| GitHub issue: 200 og 203 | Kornfargeanalyse / relativ RGB fra ortofoto | Bruk egne ortofoto som primær bilde-/rasterkilde. AR5/jordsmonn kan forklare kontekst, men skal ikke være krav for fargeindeks. |

## Implementeringsregler

1. Feltvalg og flyplanlegging skal alltid tåle manuell korrigering når Geonorge-data mangler, har svak nøyaktighet eller ikke samsvarer med faktisk drift.
2. Alle importerte felt og planleggingsenheter skal beholde kilde, hentetid og relevant kildeoppdatering når det finnes.
3. UI skal ikke fremstille NIBIO overlay som juridisk eller operativ fasit for feltgrenser.
4. Rettighetsstyrte NIBIO-lag må være konfigurerbare og kunne slås av i miljøer uten avtale.
5. Ved publisering av NIBIO-data skal kilde oppgis etter NIBIOs krav. Ved publisering av Copernicus/CLMS-avledede produkter skal kilde og eventuell modifikasjon oppgis.
6. Nye ingest-/kartissues skal angi kildetype, rettighetsstatus, forventet fallback og valideringssti.

## Nåværende teknisk status

- `apps/backend-api/app/services/geonorge_teiger.py` bruker `https://ws.geonorge.no/eiendom/v1` for teigkandidater og punktoppslag.
- Planleggings-API-et eksponerer feltkandidater, sync og punktoppslag basert på Geonorge-datalinjen.
- Bildeanalyse kan fortsatt bruke AR5 og jordkvalitet som analysekontekst, men AR5-oppslag er deaktivert som sikker runtime-default med `PHOTO_AR5_ENABLED=false`.
- `GET /api/v1/sources/status` viser om AR5, Gårdskart og jordsmonn/jordkvalitet faktisk er aktivert i miljøet.
- Gårdskart jobId-cache finnes fortsatt for eiendomslag, men henting er gated med `NIBIO_GARDSKART_ENABLED=false` som sikker default og skal ikke være primær produktkilde for feltvalg.

## Oppfølgingsbehov

- Dokumenter attribusjon i UI/rapport når NIBIO- eller Copernicus-data vises eller eksporteres.
- Fortsett Geonorge-hardening med cache/fallback og tydelig visning av nøyaktighetsklasse i planleggingsflyten.

## Offisielle kilder

- NIBIO, nedlasting av kartdata: https://www.nibio.no/tjenester/nedlasting-av-kartdata
- NIBIO, WMS-tjenester: https://www.nibio.no/tjenester/wms-tjenester
- NIBIO, WMS-tjenester AR5: https://www.nibio.no/tjenester/wms-tjenester/wms-tjenester-ar5
- NIBIO, WMS-tjenester jordsmonn: https://www.nibio.no/tjenester/wms-tjenester/wms-tjenester-jordsmonn
- NIBIO, WMS-tjeneste AR50: https://www.nibio.no/tjenester/wms-tjenester/wms-tjeneste-ar50
- NIBIO, Webservice og WMS for Gårdskart: https://www.nibio.no/tjenester/wms-tjenester/webservice-og-wms-for-gardskart
- Kartverket, åpne eiendomsdata på Geonorge: https://kartverket.no/en/api-and-data/eiendomsdata/apent-tilgjengelige-data-og-tjenester
- Geonorge register, Matrikkelen Eiendomskart Teig WFS: https://register.geonorge.no/inspire-statusregister/matrikkelen-eiendomskart-teig-wfs/339d49c3-06a5-4310-9605-fced1fe465cb
- Geonorge register, Matrikkelen Eiendomskart Teig: https://register.geonorge.no/fair-register/matrikkelen-eiendomskart-teig/087d31f2-e2d9-4cea-b3ab-49392c7bcf83
- Copernicus Land Monitoring Service data policy: https://land.copernicus.eu/en/data-policy
- Copernicus Data Space Ecosystem: https://dataspace.copernicus.eu/
