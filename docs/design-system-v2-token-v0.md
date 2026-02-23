# Flyvendebønder Designsystem v2 — tokenvurdering (punkt 2)

Dette er en praktisk startversjon for appen (`apps/web-app`) basert på dagens UI-verdier.

## Prinsipp
- Ikke endre uttrykket nå.
- Gjør dagens fargebruk forutsigbar ved å konvertere direkte verdier til semantiske token-navn.
- Hold det lite i starten: 8–12 primitive/funksjonelle farger, 2 radius-nivåer, 3 spacing-lag i praksis.

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


## Sesongtema (pilot, v1)

Vi beholder basis-tokenene fra v1 som standard, og legger på en liten sesong-modifikator for aksent/surface-hold.

### data-season attributt (app-root)
- default: `data-season="spring"`
- summer, autumn, winter kan byttes via `data-season`.

### Vår (`spring`)
- `--fb-accent-sky: #365CD2`
- `--fb-accent-sky-subtle: rgba(54, 92, 210, 0.12)`
- `--fb-accent-emerald: #1CA85D`
- `--fb-accent-emerald-subtle: rgba(28, 168, 93, 0.14)`
- `--fb-accent-bridge: #2D8FA1`
- `--fb-accent-bridge-subtle: rgba(45, 143, 161, 0.12)`
- `--fb-background-tint: linear-gradient(145deg, rgba(246, 232, 205, 0.85), rgba(222, 209, 177, 0.75))`

### Sommer (`summer`)
- `--fb-accent-sky: #4F7CFF`
- `--fb-accent-sky-subtle: rgba(79, 124, 255, 0.16)`
- `--fb-accent-emerald: #24B56D`
- `--fb-accent-emerald-subtle: rgba(36, 181, 109, 0.16)`
- `--fb-accent-bridge: #2FA3CC`
- `--fb-accent-bridge-subtle: rgba(47, 163, 204, 0.14)`
- `--fb-background-tint: linear-gradient(145deg, rgba(244, 236, 224, 0.86), rgba(210, 229, 248, 0.30))`

### Høst (`autumn`)
- `--fb-accent-sky: #4A6F9A`
- `--fb-accent-sky-subtle: rgba(74, 111, 154, 0.16)`
- `--fb-accent-emerald: #B87A3D`
- `--fb-accent-emerald-subtle: rgba(184, 122, 61, 0.18)`
- `--fb-accent-bridge: #B07A3B`
- `--fb-accent-bridge-subtle: rgba(176, 122, 59, 0.14)`
- `--fb-background-tint: linear-gradient(145deg, rgba(243, 223, 198, 0.82), rgba(219, 173, 134, 0.44))`

### Vinter (`winter`)
- `--fb-accent-sky: #5A8FD6`
- `--fb-accent-sky-subtle: rgba(90, 143, 214, 0.16)`
- `--fb-accent-emerald: #2C9A73`
- `--fb-accent-emerald-subtle: rgba(44, 154, 115, 0.14)`
- `--fb-accent-bridge: #3D9FBC`
- `--fb-accent-bridge-subtle: rgba(61, 159, 188, 0.14)`
- `--fb-background-tint: linear-gradient(145deg, rgba(236, 244, 250, 0.76), rgba(208, 224, 240, 0.40))`

### Bruksregel
- Sesongendringer skal kun treffe: `--fb-accent-*` og `--fb-background-tint` i første omgang.
- CTA-fargene (`--fb-interactive-*`) og tekstfarger holdes stabile for lesbarhet.
