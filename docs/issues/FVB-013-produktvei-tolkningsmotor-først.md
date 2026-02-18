# FVB-013 – Produktvei: tolkingsmotor først (ikke full ortofoto-stack)

## Målet
Flyvendebønder skal først og fremst være et presisjonsverktøy for å koble hvert dronebilde til agronomisk virkelighet:

- Kamera-geometri
- Treffpunkt/retning på bakken
- Usikkerhet og kvalitetsscore
- Kontekst fra NIBIO/jordsmonn

CLI/orthofoto er et mulig sideeksperiment, ikke default-plattform for kjerneverdien nå.

## Område
Produktstrategi, geometri, analyse-workflow.

## Status
Pågår.

## Prioritering (må være sann)
1. Gjør de tre kjernekomponentene robuste:
   - FVB-006 (metadata/QC/GSd + overlappsignaler)
   - FVB-009 (heading/pitch kilde + usikkerhet)
   - FVB-010 (footprint + 5-punkts sampling)
2. Synliggjør kvalitet i UI slik at bruker kan stole på beslutningene.
3. Kjør CLI/ortho-forsøk kun som begrenset valideringsspor (FVB-011/012 som sidekanal).

## Akseptanse
- Dokumentert i backlog at hovedretningen er **tolkningsmotor**.
- CLI-oppgaver kan fortsatt kjøres, men må være merket som "ekstra/eksperiment" i roadmap.
- Fullskjerm/klikkflyt skal fortsatt basere seg på punkt-geometri, ikke på krav om ortomosaikk.
- Neste sprint kan ikke gå videre til AI-/kartprodukt-klassifisering før kvaliteten i FVB-009 og FVB-010 er operativ.

## Neste arbeid
- Legg inn en egen seksjon i `docs/issues/README.md` med denne prioriteringen.
- Oppdater status på `FVB-011`/`FVB-012` til "sideeksperiment til nyttevurdering" så langt.
- Oppdater `docs/status` ved første leveranse i denne retningen.
