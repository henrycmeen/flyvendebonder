# Kildepolicy v1 for kart, feltvalg og analyse

Dette notatet er beslutningstabellen for hvilke eksterne kart- og geodatakilder
Flyvendebønder kan bygge på i M3-sporet.

Status er verifisert mot åpne kilder 2026-06-22. Dette er en teknisk
produktpolicy, ikke juridisk rådgivning. Ved ny distribusjonsform, kommersiell
pakking eller datadeling utenfor pilotmiljøet må aktuell kildeeier eller
metadata/lisensside sjekkes på nytt.

## Kort beslutning

- Bruk Geonorge/Kartverket eiendomskart teig som primær kilde for klikkbart
  teig-/eiendomsgrunnlag og feltkandidater.
- Bruk NIBIO jordsmonn/jordkvalitet og AR50 som kartoverlegg og
  analysekontekst når endepunktet er åpent og kilde/proveniens vises.
- Ikke bygg kjerneproduktet på NIBIO Gårdskart webservice/WMS eller NIBIO AR5
  WMS uten avklart Geovekst/Norge Digitalt-rettighet.
- Skill alltid mellom visuell støtte, feltvalg, bulk/ingest og analyse. En
  kilde som er nyttig som bakgrunnslag er ikke automatisk trygg som
  produktavhengighet.

## Kildematrise

| Kilde | Tilgang/lisensregel | Aktuelle endepunkter | Kartoverlegg | Feltvalg | Ingest/bulk | Analysekontekst |
| --- | --- | --- | --- | --- | --- | --- |
| Geonorge/Kartverket Matrikkelen - Eiendomskart Teig | Kartverket beskriver utvalgte matrikkeldata på Geonorge som fritt tilgjengelige uten søknad. Teig-WFS-registeret beskriver daglig oppdatert uttrekk fra Matrikkelen. | `https://wfs.geonorge.no/skwms1/wfs.matrikkelen-eiendomskart-teig?Service=WFS&Request=GetCapabilities`, `https://ws.geonorge.no/eiendom/v1/` | Ja, for eiendoms-/teiggrenser der visning trengs. | Ja, primær V1-kilde for teigbaserte feltkandidater og kartklikk. | Ja, for geometri/proveniens når payload og rategrenser håndteres eksplisitt. | Ja, men bare som eiendoms-/teigkontekst, ikke agronomisk klassifisering. |
| NIBIO jordsmonn/jordkvalitet WMS | NIBIO publiserer WMS-tjenester for jordsmonntema. Nedlastbare NIBIO-data uten passord er oppgitt som NLOD 1.0 med kildetekst `Kilde: NIBIO`. | Appens aktive kartlag bruker `https://wms.nibio.no/cgi-bin/jordsmonn` med `Jordkvalitet`. NIBIO lister også jordsmonn-WMS-er som `jordsmonn_harmonisert`. | Ja, som forklarende jordkvalitets-/jordsmonnlag. | Nei, ikke som primær feltgeometri. | Bare etter egen vurdering av nedlastings-/WFS-kilde og lisens. Ikke anta at WMS er bulk-kilde. | Ja, for forsiktig kontekst rundt foto/felt. Proveniens og usikkerhet skal vises. |
| NIBIO AR50 | NIBIO lister AR50 WMS som offentlig WMS-tjeneste. Bruk som grovere arealressurskontekst, ikke som presis skiftegrense. | `https://wms.nibio.no/cgi-bin/ar50_2?` | Ja, for grovt areal-/skog-/jordbruksoverlegg. | Nei, for grovt til feltvalg. | Bare fra dokumentert nedlasting under korrekt lisens. | Ja, grov kontekst der AR50-oppløsningen er tydelig. |
| NIBIO FKB-AR5 / AR5 WMS | NIBIOs AR5-WMS-side sier tjenesten er forbeholdt parter i Geovekst og Norge Digitalt. | `https://wms.nibio.no/cgi-bin/ar5?` | Bare i miljøer hvor rettighet er avklart. Ikke offentlig/bred standardavhengighet. | Nei, ikke som primær feltvalgskilde i åpen pilot. | Nei, med mindre særskilt rettighet/avtale finnes. | Bare med eksplisitt rettighetsavklaring og synlig provenance. |
| NIBIO Gårdskart webservice/WMS | Gårdskart-nettjenesten er åpen for alle, men NIBIOs side for webservice/WMS sier webservice/WMS er forbeholdt Geovekst/Norge Digitalt-parter. | `https://kart17.nibio.no/gardskart_ws_04/gpiareastat` og etterfølgende Gårdskart-WMS | Ja, kun som lokal/intern visuell støtte når rettighet og drift er avklart. | Nei, ikke primær produktavhengighet. Bruk Geonorge teig i stedet. | Nei. Ikke bulk-/ingestgrunnlag uten avtale. | Begrenset, bare som kontroll-/sammenligningskontekst. |

## Operative regler

1. Nye feltvalg- og planleggingssaker skal starte med Geonorge teigdata som
   autoritativt vektorgrunnlag.
2. NIBIO WMS-lag kan brukes i kartet når de hjelper brukeren å forstå feltet,
   men UI og API må kalle dem kontekstlag, ikke fasit.
3. AR5- og Gårdskart-WMS skal ha en eksplisitt rettighetsbeslutning før de
   brukes i offentlig/bred distribusjon eller backend-analyse.
4. Alle lagrede felt, analyser og eksporterte artefakter skal kunne vise
   `source`, `source_endpoint`, `source_fetched_at` og eventuell
   `source_license_note` når de bygger på ekstern kilde.
5. NIBIO-materiale som publiseres videre skal som minimum ha synlig
   kildeangivelse `Kilde: NIBIO` når NLOD-regelen gjelder.
6. Endepunktnavn skal ikke hardkodes som produktpolicy alene. Når NIBIO eller
   Geonorge varsler endring, må kode, README og denne policyen oppdateres
   sammen.

## Mapping til eksisterende arbeid

| Spor | Kildehistorie | Konsekvens |
| --- | --- | --- |
| #195 / HEN-42 Feltvalg og flyplanlegging | Geonorge teigdata er primær kilde for klikkbart jordvalg. NIBIO jordsmonn/AR50 kan støtte brukerforståelse som overlay. Gårdskart og AR5 skal ikke være primær produktavhengighet. | Første tekniske slice bør hente/lagre feltkandidater med Geonorge-proveniens og la bruker korrigere manuelt. |
| HEN-52 Geonorge teiger | Samme kilde som #195: Matrikkelen - Eiendomskart Teig WFS eller nedlasting fra Geonorge. | Hold teigoppslag bak backend-kontrakt og test respons/proveniens deterministisk. |
| HEN-17 AR5/jordsmonn-analyse | Jordsmonn/jordkvalitet kan brukes som kontekst. AR5 krever rettighetsavklaring før bred bruk. | Ikke la AR5-resultat bli påkrevd felt-/fotoanalyse i åpen pilot. Jordsmonn-endepunkt må være aktivt og testet. |
| HEN-55 STAC/proveniens | Raster-/processingartefakter skal ikke skjule ekstern kildebruk. | STAC/interne metadata bør bære kilde, endepunkt, hentetidspunkt og lisensnotat der eksterne kilder påvirker produktet. |
| #201 Jordsmonnlag | Frontend er rettet til aktivt `cgi-bin/jordsmonn`-endepunkt i PR #202. Backend README/konfig må også ryddes hvis fotoanalyse fortsatt bruker gammelt `cgi-bin/jordkvalitet`. | Opprett eller bruk egen backend-oppfølging før jordsmonn-analyse gjøres til port i M3. |

## Kilder sjekket

- [NIBIO: Nedlasting av kartdata](https://www.nibio.no/tjenester/nedlasting-av-kartdata)
- [NIBIO: WMS-tjenester](https://www.nibio.no/tjenester/wms-tjenester)
- [NIBIO: WMS-tjenester AR5](https://www.nibio.no/tjenester/wms-tjenester/wms-tjenester-ar5)
- [NIBIO: Webservice og WMS for Gårdskart](https://www.nibio.no/tjenester/wms-tjenester/webservice-og-wms-for-gardskart)
- [NIBIO: WMS-tjenester jordsmonn](https://www.nibio.no/tjenester/wms-tjenester/wms-tjenester-jordsmonn)
- [NIBIO: WMS-tjeneste AR50](https://www.nibio.no/tjenester/wms-tjenester/wms-tjeneste-ar50)
- [Kartverket: Åpent tilgjengelige data og tjenester](https://kartverket.no/en/api-and-data/eiendomsdata/apent-tilgjengelige-data-og-tjenester)
- [Geonorge Register: Matrikkelen - Eiendomskart Teig WFS](https://register.geonorge.no/inspire-statusregister/matrikkelen-eiendomskart-teig-wfs/339d49c3-06a5-4310-9605-fced1fe465cb)
