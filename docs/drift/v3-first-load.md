# V3: målt første lasting av 3D-avhengigheten

Kontrollert 5. oktober 2026 på Mac mini-kandidat, ikke produksjonsmåling
eller fysisk mobilaksept. #297/#298 eier videre ytelsesarbeid.

## Før retting

Commit `ed9f7b5cf9f8e75c640d36b55d595dba758396df`, ferdig Vite-build,
preview 5250 mot isolert backend 8825. Ny IAB/Chromium-fane, 1280×720,
`/app/`, sidebar `data-collapsed=true`, ett model-viewer-element i DOM.
Ingen åpning av meny eller innstillinger før ressursavlesing.

Browser Resource Timing:

| Ressurs | Encoded body | Decoded body | Transfer inkl. overhead | Start / varighet |
| --- | ---: | ---: | ---: | --- |
| index-Crm810rX.js | 553 430 B | 1 896 245 B | 553 730 B | 29,6 / 85,6 ms |
| meen-gard-profile.glb | 6 504 036 B | 6 504 036 B | 6 504 336 B | 391,9 / 633 ms |

Samlet encoded JS+GLB: 7 057 466 B. Dette inkluderer ikke karttiles, CSS,
fonter eller API-data. Encoded størrelse gjelder denne serverresponsen,
ikke en universell gzip-/nettverksgaranti. Navigasjonens DOMContentLoaded
var 168,5 ms og load 205,2 ms; modellen starter senere, så load alene er
ikke bevis for ferdig gårdsmodell eller meningsfull kartvisning.

Kildekode: både sidebar og innstillinger importerer PropertyHero3D statisk;
hero importerer model-viewer statisk. Den lukkede menyen skjuler modellen
med opacity/max-height, men hindrer ikke ressurslastingen. Rettingen utsetter
renderer og GLB til synlig meny/innstillinger, ikke bare dele
samme kritiske bytes i kosmetiske chunks.

Rå førmåling på kontrollmaskinen: `work/v3-context/v3-initial-resources-before.json`.
Nettverks- og maskintidene gjelder lokalt LAN på desktop; ingen moderat
mobilprofil, feltmåling, Safari-aksept eller Core Web Vitals-konklusjon.

## Etter retting og feilprøver

Samme produksjonsbuild/preview og fersk IAB-fane, 1280×720, lukket meny:

| Ressurs | Encoded body | Decoded body | Transfer inkl. overhead | Start / varighet |
| --- | ---: | ---: | ---: | --- |
| index-41OOF7DP.js | 264 921 B | 882 472 B | 265 221 B | 21,5 / 60,5 ms |
| model-viewer / GLB | Ikke forespurt | Ikke forespurt | Ikke forespurt | Ikke startet |

Hoved-JS encoded body er redusert 52,13 %. Ingen model-viewer-elementer
finnes i DOM før synlig etterspørsel. SDK og 6 504 036 B GLB lastes først
ved åpen meny eller innstillinger. SDK-chunken er 1 012 873 B decoded
(Vite rapporterer 288,69 kB gzip); hoved-JS er fortsatt over 500 kB.
Dette løser ikke hele #297/#298 og endrer ikke størrelsen på GLB-filen.

Normal settings-modell er loaded=true, orbit 32deg 68deg 55%, FOV 12deg.
På 390×844 lastes ingen SDK/GLB ved lukket bibliotekmeny. Ved Mer lastes
modellen, loaded=true, orbit 36deg 68deg 85%, FOV 22deg. Dokumentbredde
og scrollbredde er begge 390 px. Menyen kan lukkes igjen.

Kontrollerte feilprøver i egne midlertidige nettleserfaner:

- WebGL2-context ble gjort utilgjengelig før første aktivering. Ingen SDK,
  GLB eller model-viewer ble lastet. SVG beholdes med «Illustrasjon · 3D
  kunne ikke lastes» i innstillinger.
- Network.setBlockedURLs blokkerte bare lokal meen-gard-profile.glb.
  SDK ble importert; modellens error beholdt SVG og fjernet viewer.
- Testfanene er lukket; manipuleringene påvirker ikke levert preview.

Plassholderen er merket som illustrasjon, ikke foto/modell av Meen gård.
Lasteren prøver WebGL2 bare ved synlig behov og frigjør probe-context.
Importavbrudd og React-event-cleanup er uavhengig kodegjennomgått.

Full validate + isolert stack smoke består: 362 backendtester, frontend-
tester, lint og build. Logg /tmp/flyvendebonder-v3-lazy-final-validation.log.
Rå ettermåling: work/v3-context/v3-initial-resources-after.json.
Skjermbilder på kontrollmaskinen: v3-settings-after-lazy.png,
v3-mobile-menu-after-lazy.png, v3-webgl-fallback.png, v3-glb-fallback.png.
Fysisk mobil, moderat nett/GPU, Safari og CWV er fortsatt ikke akseptert.
