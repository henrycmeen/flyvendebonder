# V2: opptak over tid og timelapse

Status: kronologisk bibliotekavspilling er implementert og kontrollert med 12 bilder, stopp ved slutt, pause ved nettverksfeil og nytt forsøk. Dette dokumentet beholder hele videre kontrakten; områdespesifikt utvalg, delbar avspillingslenke og to-opptakssammenligning er fortsatt ikke implementert.

## Verifisert utgangspunkt
- Original liquid-velger med år/årstider er gjenopprettet etter Henrys designrettelse. Henry har valgt dette panelet som grunnlag; direkte datovalg er nå en enkel rad med faktiske opptaksdager inne i originalpanelet. Biblioteket har en egen kronologisk avspiller som starter pauset.
- Biblioteket navigerer bilder fra nyeste til eldste. Kartet kan bruke nærmeste-posisjon-rekkefølge (`buildNearestPath`). Ingen av disse er en tilstrekkelig kontrakt for kronologisk timelapse.
- Foto har opptakstid, posisjon og bilde-/miniatyrreferanser. Tidslinjen har daglige arkivantall. Arkivantall dokumenterer ikke hvor mange bilder som dekker samme utsnitt.
- Biblioteket har paginering. En avspiller må ikke presentere bare innlastede bilder som et komplett opptak.

## Brukerflyt
1. Velg opptaksdager og et område. Vis hvilke bilder som inngår, hvor mange som er tilgjengelige og om utvalget er komplett.
2. Åpne en kronologisk bildesekvens. Vis opptaksdato og klokkeslett ved selve bildet, valgt område og plassering i sekvensen.
3. Bruk Forrige, Neste, Spill av/Pause og hastighet. Ingen automatisk start. Ved slutten stopper avspillingen; gjentakelse er et eksplisitt valg.
4. Sammenlign to valgte opptak manuelt. Vis forskjellige posisjoner/utsnitt tydelig; et skiftende kamera skal ikke framstilles som et registrert før/etter-bilde.

## Atferdskontrakt
- Sorter etter faktisk opptakstid stigende og ID som stabil tiebreaker. Manglende/ugyldig tidspunkt er en synlig avvikskategori, ikke vilkårlig første bilde.
- Vis ukjent tidssone som ukjent; ikke konverter naive kamera-tider til påstått UTC. Kalenderdato og vist opptakstid må følge samme dokumenterte regel.
- Vis bare en ferdig lastet ramme som gjeldende bilde. Pause ved lastefeil, tilby nytt forsøk og bevar valgt bilde og tidsstempel.
- Avbryt gammel lasting ved skifte av sekvens. Gamle svar skal ikke overstyre den nye sekvensen. Hold forhåndslasting og minnebruk begrenset.
- Pause når visningen lukkes eller dokumentet skjules. Tastatur, mobil og redusert bevegelse skal fungere uten ufrivillig avspilling.
- Delbare lenker bevarer utvalg og gjeldende bilde, men starter alltid pauset.
- Bruk eksisterende shadcn-komponenter og glassflater. Behold kartet og 3D-gården som orientering rundt bildene.

## Akseptansebevis før publisering
- En komplett sekvens med flere dager og like tidsstempler viser stabil rekkefølge, riktig tidspunkt og stopper på siste ramme.
- En stor paginert sekvens viser komplett/ufullstendig status korrekt og har avgrenset forhåndslasting.
- Langsom eller ødelagt bildefil gir synlig status, pause og fungerende nytt forsøk. Bytte av bilde/sekvens under lasting viser ikke en gammel ramme med nytt tidsstempel.
- Tastatur og mobil: kontrollene er tilgjengelige, fokus beholdes, ingen horisontal side-overflyt; lukking/skjult dokument stopper avspilling.
- To opptak med forskjellig kameravinkel er korrekt merket og presenteres ikke som geometrisk justert sammenligning.

Videre implementering og publisering følger samme review-, CI- og Henry-godkjenning som øvrig V2. Denne kontrakten endrer ikke produksjon eller den eksisterende publiseringsgodkjenningen.

## Mobilkontroll 30. september

På 320 × 740 CSS-piksler er den dupliserte spilleroverskriften, forklaringen og lukkeknappen fjernet; dialogens tittel, forklaring og lukkeknapp beholdes. Bildet bruker 32dvh på smal skjerm og fortsatt 48dvh fra sm. Forrige/Spill/Neste og visningstid er synlige uten scrolling. Ingen horisontal side-overflyt (scrollWidth = innerWidth = 320). Neste bilde oppdaterer tidspunkt og indeks; lukking returnerer fokus til «Vis opptak over tid». Kontrollert i separat nettleserfane, uten å endre hovedforhåndsvisningens størrelse eller kartdesign. Uavhengig lesende review fant ingen regresjoner.

## Avklart omfang

Henry presiserte 30. september kl. 13 at poenget er opprydding i appen, ikke mer kompleksitet. Videre kontrakt over beskriver muligheter, ikke ekstra akseptansekrav eller bestilt implementering i denne leveransen. Områdeutvalg, delbare avspillingslenker og to-opptakssammenligning skal ikke legges til nå.
