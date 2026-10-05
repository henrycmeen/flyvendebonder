# Flyvendebønder Designsystem v2 — tokenvurdering (punkt 2)

Dette er en praktisk startversjon for appen (`apps/web-app`) basert på dagens UI-verdier.

## Prinsipp
- Ikke endre uttrykket nå.
- Gjør dagens fargebruk forutsigbar ved å konvertere direkte verdier til semantiske token-navn.
- Hold det lite i starten: 8–12 primitive/funksjonelle farger, 2 radius-nivåer, 3 spacing-lag i praksis.

## Skjermkontrakter
- Skjermmening og arbeidsdeling mellom `Kart`, `Album`, `Import` og `Fotoinspektør`
  er dokumentert i `docs/skjermkontrakter-v1.md`.
- Nye DS-v2-endringer bør kunne si hvilken skjermkontrakt de forbedrer, slik at
  token-, layout- og komponentarbeid ikke løsriver seg fra brukerjobben.

## Kjernefarger (primitive)
- `--fb-canvas-0: #f3ddbe`
- `--fb-canvas-1: #dfbe96`
- `--fb-canvas-2: #c89d6f`
- `--fb-paper: #fff8ee`
- `--fb-earth-950: #2b170d`
- `--fb-earth-900: #3f2413`
- `--fb-earth-800: #5a3219`
- `--fb-earth-700: #723b1a`
- `--fb-earth-600: #915027`
- `--fb-earth-500: #b77a4a`

## Semantiske token-navn (første nivå)
- `--fb-surface-page: var(--fb-paper)`
- `--fb-surface-raised: rgba(255, 248, 238, 0.82)`
- `--fb-surface-overlay: rgba(24, 18, 12, 0.28)`
- `--fb-text-primary: var(--fb-earth-950)`
- `--fb-text-secondary: rgba(43, 23, 13, 0.86)`
- `--fb-text-muted: rgba(43, 23, 13, 0.64)`
- `--fb-border-subtle: rgba(184, 121, 73, 0.3)`
- `--fb-border-strong: rgba(42, 23, 10, 0.38)`
- `--fb-focus-ring: #a56c34`
- `--fb-accent-brand: #915027`
- `--fb-accent-accent: #dfbe96`
- `--fb-danger: #bb4335`
- `--fb-accent-sky: #365CD2`
- `--fb-accent-sky-subtle: rgba(54, 92, 210, 0.16)`
- `--fb-accent-emerald: #1CA85D`
- `--fb-accent-emerald-subtle: rgba(28, 168, 93, 0.16)`
- `--fb-accent-bridge: #2D8FA1`
- `--fb-accent-bridge-subtle: rgba(45, 143, 161, 0.14)`

## Interaksjonsfarger
- `--fb-interactive-default: var(--fb-earth-700)`
- `--fb-interactive-hover: var(--fb-earth-800)`
- `--fb-interactive-active: var(--fb-earth-900)`
- `--fb-interactive-disabled: rgba(43, 23, 13, 0.2)`

## Radius + spacing (v0)
- `--fb-radius-xs: 6px`
- `--fb-radius-sm: 10px`
- `--fb-radius-md: 12px`
- `--fb-radius-lg: 16px`
- `--fb-radius-pill: 999px`
- `--fb-space-1: 4px`
- `--fb-space-2: 8px`
- `--fb-space-3: 12px`
- `--fb-space-4: 16px`
- `--fb-space-5: 20px`
- `--fb-space-6: 24px`

## Elevation + fokus (v0)
- `--fb-shadow-subtle: 0 1px 0 rgba(255, 251, 244, 0.75) inset`
- `--fb-shadow-raised: 0 20px 38px rgba(58, 28, 8, 0.22)`
- `--fb-shadow-floating: 0 12px 22px rgba(24, 11, 4, 0.33)`
- `--fb-focus-glow: 0 0 0 2px rgba(165, 108, 52, 0.28)`

## App-first tema-matrise (v2)
- `--fb-theme: app`
- `--fb-background: var(--fb-canvas-0) -> radial-gradient(circle at 20% 0%, var(--fb-canvas-0), var(--fb-canvas-1) 52%, var(--fb-canvas-2) 100%)`
- `--fb-panel-style: glass-low`
- `--fb-panel-alpha: 0.38`

## Neste avklaring (for oss)
1. Bekreft at disse baseline-navnene er OK.
2. Velg om CTA fortsatt skal være `--fb-earth-700` eller gå til `--fb-earth-600`.
3. Bekreft at blå/grønn kun brukes som aksent/state-farger, og ikke som primær CTA.
4. Avklar om `--fb-accent-bridge` brukes i kartlag/legend også.

Når dette er bekreftet, går vi videre i punkt 2–3:
- implementere token-fil i `apps/web-app` (`src/styles/tokens.css` eller tilsvarende)
- mappe 6–8 kerneklasser i Tailwind-tokenlaget
- begynne pilot-refaktor for map shell


## Sesongtema (pilot, v2)

Fokuset er nå å ha et fungerende system med tydelige koblingspunkter, ikke ferdig finjusterte farger.

### data-season attributt (app-root)
- `data-season="spring|summer|autumn|winter"` settes på app-root.
- Dette styrer `--fb-season-solid` og `--fb-background-tint`.

### Sesongtoken-kontrakt (systemnivå)
- Basetokens per sesong i CSS:
- `--fb-map-season-spring*`
- `--fb-map-season-summer*`
- `--fb-map-season-autumn*`
- `--fb-map-season-winter*`
- `--fb-map-season-mixed*`
- Hver har varianter: `base`, `dark`, `soft`, `soft-strong` (+ `bg` for app-bakgrunn).

### Map-integrasjon
- Enkeltmarkør får `data-season` utledet fra `captured_date`.
- Cluster får sesong kun når alle barn er samme sesong.
- Ved blanding brukes `mixed`-tokenene.

### Bruksregel
- Komponenter bruker semantiske tokens (`--fb-season-solid`, `--fb-chip-active-*`, `--fb-map-season-*`), ikke direkte hex.
- Fargeverdier kan justeres senere uten kodeendring i komponentene.

## DS-03 semantic layer (status)

Tailwind-mapping er nå etablert i `apps/web-app/tailwind.config.js` med disse gruppene:
- `fb-surface` (`base`, `ghost`, `overlay`)
- `fb-text` (`primary`, `secondary`, `muted`)
- `fb-border` (`subtle`, `strong`)
- `fb-interactive` (`default`, `hover`, `active`, `disabled`)
- `fb-season` (`solid`, `spring`, `summer`, `autumn`, `winter`, `mixed`)

Første migrering av core-komponenter er gjort:
- `Button`
- `Input`
- `Card`
- `Tabs`
- `Dialog`
- `Switch`
- `Label`
- `ScrollArea`
- `Tooltip`

## DS-05 layout primitives (status)

Nye layout-primitives er etablert i `apps/web-app/src/components/ui/layout-primitives.tsx`:
- `PageShell`
- `Section`
- `Stack`
- `Grid`
- `Divider`

Pilotbruk er lagt i `apps/web-app/src/components/album-page.tsx` for å validere strukturmønsteret.

## DS-06 pilot-refaktor (status)

Layout-primitives er nå brukt i tre aktive flater:
- `apps/web-app/src/components/album-page.tsx`
- `apps/web-app/src/components/side-rail.tsx` (innstillingsdialog)
- `apps/web-app/src/components/timeline-bottom.tsx`

Målet er å bevise at primitives fungerer i innholdsflow (album), kontrollflow (settings) og map-flow (timeline) før videre utrulling.

## DS-07 Info-site token bridge (påbegynt)
- La til `apps/info-site/theme.css` som binder info-site til samme semantiske tokenmodell (`--fb-*`) som web-app.
- Definerte sesongfarger som faste (ingen gradient): `spring`, `summer`, `autumn`, `winter`.
- Mappet eksisterende info-site variabler (`--bg`, `--surface`, `--line`, `--text`, `--accent`) til designsystem-tokens.
- Lagt inn sesongstyrt aktivfarge for CTA/chips med tydelig fokus-state.
- Neste steg: flytte flere konkrete komponentflater i info-site fra ad hoc-farger til kun semantiske tokens.

## DS-08 Info-site light mode + app-language bridge
- Info-site er satt i light-only modus for konsistent uttrykk med app-prioritet (appen er designkilden).
- Hvit bakgrunn og semantiske overflater er nå default i info-site token bridge.
- Dag/natt-toggle skjules og dark-klasse/data-theme blir overstyrt til light.
- La inn gjenbrukbare primitives i info-site (`.fb-shell`, `.fb-section`, `.fb-stack`, `.fb-card`, `.fb-btn`) for gradvis migrering.
- Prinsipp: beholde eksisterende copy/informasjonsstruktur, men erstatte visuell styling med systemtokens først.

## DS-09 Infoside: første konkrete migrering + opprydding
- Knyttet inn `theme.css` i `apps/info-site/index.html` slik at token-bridge faktisk brukes.
- Migrerte toppseksjon (`#plan`) til primitives (`fb-shell`, `fb-section`, `fb-stack`, `fb-card`) uten å endre copy/struktur.
- Gjorde timeline-kort konsistente med semantiske overflater og border/shadow fra systemet.
- Flatet ut app-CTA i footer til systemknapp-oppførsel (ingen liquid-effekt i infosiden).
- Ryddet ubrukt/legacy kode:
  - fjernet `?bg=white` preview-logikk i `script.js` + `styles.css`.
  - fjernet `prefers-color-scheme: dark`-blokker i `base.css`.
  - fjernet ekstra tvungen light-mode observer/script (ikke nødvendig etter light-only CSS).

## DS-10 Infoside: CTA bugfix + seksjon 2/3 videre migrering
- Fikset footer-CTA bug: erstattet skjult track/thumb-markup med eksplisitt, synlig label (`demo-link__label`).
- `Oppdateringer` flyttet videre til primitive-oppsett med `fb-stack` på seksjon og timeline.
- `Appstatus` pakket i en semantisk `fb-card` (`appstatus-card`) for samme språk som øvrige flater.
- Ryddet rester av tidligere CTA-overstyring i `theme.css` som pekte på fjernet markup.

## DS-11 Infoside: legacy-CTA cleanup + mer tokenisering
- Fjernet legacy CTA-klasser fra markup i infosiden (`demo-link*`), og bruker nå ren `fb-btn` for app-lenken.
- Oppdatert `theme.css` til DS-selektorer på footer (`.footer--app .fb-btn`) i stedet for legacy CTA-selektorer.
- Flyttet flere toppnivåstiler til semantiske tokens:
  - flytende brand-chip (`.brand--floating`) bruker `--fb-*` overflate/border/skygge.
  - hero/media-frame bruker tokenisert border.
- Ryddet ubrukt CSS i `styles.css` ved å fjerne gamle `demo-link*`-blokker og tilhørende keyframes (`liquidFloat`, `logoSpin`) som ikke lenger brukes av markup.

## DS-12 Infoside: dynamisk logo-skala
- La inn delt typografitoken for hero: `--fb-hero-title-size`.
- Knyttet logo-størrelse til samme skala via `--fb-brand-logo-size: calc(var(--fb-hero-title-size) * 0.9)`.
- Oppdatert floating brand-logo til responsiv størrelse gjennom token i stedet for fast `28px`.
- Resultat: logoen følger samme visuelle rytme som H1/hovedtypografi og ser ikke underdimensjonert ut på større skjermer.

## DS-13 Infoside: rammeløst uttrykk
- Fjernet rammer/border i infosiden som default i tokenlaget (`theme.css`).
- Gjelder cards, section-dividers, timeline-kort, appstatus-kort, flytende brand-chip og media-frame-linje.
- Knapper er nå rammeløse som standard på infosiden.
- Unntak: app-knappen i footer beholder border som tydelig primær handling.

## DS-14 Info-side: legacy-opprydding (i pågående fase)
- Fjernet gjenværende `demo-link`-legacy fra infosidens operative CSS (`styles.css`).
- Rengjorde base/theme-verdier for infosiden slik at bakgrunn, tekst- og linjevariabler nå peker mot token-kontrakter i stedet for lokale, uoverensstemmende literals.
- Lagt inn tokenstyrt media-frame-håndtering i infoside-lagene og fjernet lokale hardkodede visuelle overrides der de ble brukt i stedet for DS-variabler.
- Neste steg: fortsette samme mønster i web-app for de siste hardkodede farger på utsatte flater (kart/album/panel-overstyringer), og deretter rydde ubrukte class-blocks i `base.css`.

## DS-15 Infoside: scope-restriksjon + side-effektkontroll
- Reduserte brede tema-regler i `apps/info-site/theme.css` fra globale knapp- og kort-selectors (`button`, `.btn`, `.cta`, `.panel`, `.surface`, `.card`, dark-mode hooks) til DS-primære klasser (`.fb-btn`, `.fb-card`).
- Gjør infoside-stylingen mer forutsigbar og mindre konfliktsensitiv mot tilfeldige DOM-elementer.
- Ryddet også resterende legacy-blokker i `apps/info-site/base.css` som ikke lenger brukes av nåværende markup (`.cta`, `.button`, `.email`, tilhørende motion/hover-regler).

## DS-16 Web-app: motion baseline (Epic #32 pilot)
- Etablerte eksplisitte motion-tokens i `apps/web-app/src/index.css`:
  - `--fb-motion-duration-{micro,small,medium,large}`
  - `--fb-motion-easing-{standard,accelerate,decelerate}`
- Oppdaterte kjernekomponenter (`Button`, `Switch`, `Input`, `Tabs`, `Dialog`, `Tooltip`) til tokenisert motion-regime med tydeligere state-respons.
- Fjernet kontinuerlig `timeline-chip` sommer-sway-loop og flyttet til subtil hover/focus-respons uten loop.
- Strammet `prefers-reduced-motion` med global fallback for transition/animation + transform-fjerning på chips/dots/logo-hover.
- La til typekontrakt for motion i `apps/web-app/src/lib/motion-tokens.ts` for videre utvidelse.

## DS-17 Web-app: core UI primitive completion
- Lagt til manglende DS-04-primitives i `apps/web-app/src/components/ui/`:
  - `Textarea`
  - `Alert`
  - `Skeleton`
  - `EmptyState`
- Alle fire bruker eksisterende `fb-*` semantiske tokens for surface, tekst, border, focus/state og motion.
- `Textarea` speiler `Input`-kontrakten for `aria-invalid`, `feedbackState`, disabled og focus-ring.
- `Alert` har `default`, `success`, `warning` og `error`-varianter uten egne hardkodede komponentfarger.
- `Skeleton` respekterer `prefers-reduced-motion` via `motion-reduce:animate-none`.
- `EmptyState` gir en felles standard for tomme kart-, album-, import- og inspeksjonsflater.
- Se `docs/ui-audit.md` for oppdatert M2-status og resterende lukking av #31.


## App pass 5. oktober 2026: enklere flater
Referanse: https://www.fluidfunctionalism.com/docs/button og /docs/fluid-hover.
Visuelt undersøkt desktop og mobil: nøytrale flater, kompakte knapper (målt 36 px høyde, 8 px radius), og ett flyttbart menyhøydepunkt.
Appen gjenbruker egne shadcn/Radix-primitives: 36 px desktopknapp, 44 px minimum på mobil, svart primærhandling, rolige sekundærhandlinger.
Mobilens dock får én delt markering for aktivt valg og peker-/tastaturfokus; CSS-overgang uten nye animasjonsavhengigheter. Dette er en tilpasning, ikke referansens framer-motion-baserte spring/nearest-item-motor.
Biblioteket viser kun bilder og datogrupper, med filtre i docken på mobil og synlig verktøylinje på desktop.
Faglige detaljer og videre arbeid på Skogbruk samles under «Om datagrunnlaget». Arealets begrensning står fortsatt ved hvert bilde.
