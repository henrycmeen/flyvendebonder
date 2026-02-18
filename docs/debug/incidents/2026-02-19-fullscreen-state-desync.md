---
slug: fullscreen-state-desync-old-view
reported_by: stabilitetsrunde
---

# Incident: Fullskjerm viser gammel visning ved exit

## Scenario
1. Åpne bilde i detalj/fullskjerm med kartutsnitt.
2. Gjør raske bytter mellom bilder, hover og metadata-redigering.
3. Avslutt fullskjerm.

## Forventet
Kun aktiv visning og gjeldende bilde-state skal være synlig etter exit.

## Faktisk
I enkelte tilfeller vises en eldre kart-/metadata-visning kortvarig, eller kartlag tegnes på nytt med gammel state.

## Sporingsinfo
- Frontend hadde tidligere flere uavhengige state-kilder uten tydelig sekvens/abort ved raske UI-overganger.
- Symptomene opptrer uten backend-feil (klient-side state/desync).

## Sannsynlig rotårsak
Race mellom asynkrone state-oppdateringer (foto-select, map focus, inset render) når fullskjerm lukkes mens tidligere request/render fortsatt fullfores.

## Fikstiltaksforslag
- Krev gyldig sekvens-token for oppdatering av kartfokus og detaljpanel.
- Nullstill transient hover/focus-state eksplisitt ved fullscreen-exit.
- Behold defensive guards i kartkomponenter for ugyldige koordinater.
