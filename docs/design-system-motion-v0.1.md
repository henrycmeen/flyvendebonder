# Flyvendebønder Motion Spec v0.1

## Formål
Etablere et tydelig, konsistent og tilgjengelig motion-system for `apps/web-app`, forankret i designsystem v2 og Epic #32.

## Prinsipper
1. Feedback først: interaksjon svarer innen 100ms.
2. Subtilt som standard: hyppig brukte kontroller får liten, funksjonell bevegelse.
3. Ingen layout-shift: animer kun `transform`, `opacity`, `box-shadow`.
4. State-tydelighet: `idle`, `hover`, `focus-visible`, `pressed`, `disabled`, `loading`, `success/error` ved behov.
5. Tilgjengelighet: respekter `prefers-reduced-motion`, unngå kontinuerlig loop i vanlig interaksjon.

## Motion-tokens (kontrakt)
- Duration:
  - `micro`: `100ms`
  - `small`: `160ms`
  - `medium`: `240ms`
  - `large`: `360ms`
- Easing:
  - `standard`: `cubic-bezier(0.2, 0.8, 0.2, 1)`
  - `accelerate`: `cubic-bezier(0.4, 0, 1, 1)`
  - `decelerate`: `cubic-bezier(0, 0, 0.2, 1)`

Kilder i kode:
- `apps/web-app/src/index.css` (`--fb-motion-*`)
- `apps/web-app/src/lib/motion-tokens.ts`

## Komponentregler (første baseline)
- `Button`:
  - Hover: subtil `scale(1.01)` (`micro + standard`)
  - Press: `scale(0.98)` (`micro + accelerate`)
  - Loading: disable + spinner, bredde bevares
- `Switch`:
  - Knott flyttes med `small + standard`
  - Ingen overshoot/bounce
- `Input`:
  - Border/fokusovergang med `small + standard`
  - `aria-invalid` gir feilfarge uten shake
- `TabsTrigger`:
  - Samme hover/press-respons som knapper
- `Dialog`:
  - Overlay: fade inn/ut
  - Panel: fade + kort Y-forskyvning, åpne/lukke-easing separert
- `Tooltip`:
  - Fade + liten Y-forskyvning inn/ut
- `Timeline chip/dot`:
  - Samlet transition-regime i CSS
  - Ingen kontinuerlig sommer-sway-loop

## Redusert bevegelse
I `@media (prefers-reduced-motion: reduce)`:
- Alle animation/transition varigheter settes til nesten null.
- Translasjon/skalering fjernes på sentrale chips/dots/logo-hover.
- Kritiske elementer beholder lesbar state uten bevegelse.

## Scope for Epic #32 (arbeidsplan)
### M-01 Motion foundation
- Felles tokens + easing-regler
- Redusert-bevegelse baseline

### M-02 Core wrappers (shadcn)
- `Button`, `Input`, `Switch`, `Tabs`, `Dialog`, `Tooltip`
- Loading-state-kontrakt for `Button`

### M-03 Timeline micro-interaksjoner
- Chips/dots med state-konsistens
- Sesongikon-respons uten kontinuerlig loop

### M-04 Validation + feedback states
- Definere `success/error` mønster for inputs og async handlinger
- Verifisere `aria-invalid`, `aria-describedby`, `aria-busy`

### M-05 Motion QA
- Enkel sjekkliste pr komponent:
  - Ingen `transition-all` på hyppig brukte elementer
  - `prefers-reduced-motion` fungerer
  - Ingen eksplisitt `linear` i transitions (bruk tokens/easing i stedet)
  - Ingen layout-shift ved hover/press/loading

### M-06 Governance
- Innført PR-krav (v1):
  - Før/etter-skjermbilder for UI-endringer
  - Kort notat om motion-state påvirkning
  - Verifisering på mobil + desktop

## Vedtak
1. Loading-spinner beholdes kun på eksplisitt loading-state.
2. Motion-lint er aktivert med `apps/web-app/scripts/motion-lint.sh` og npm-scriptet `npm run motion:lint` i `apps/web-app`.
3. Motion-kontrakten gjelder `apps/web-app` i pilotfasen. `apps/info-site` utsettes til senere steg.
4. Linear timing i `animation` blir rapportert av lint for gjennomgang, men blokkerer ikke (kun transitions blokkeres).

## Ferdig status
- ✅ M-01 Motion foundation
- ✅ M-02 Core wrappers
- ✅ M-03 Timeline micro-interaksjoner
- ✅ M-04 Validation + feedback states (base-kontrakter for state på Input/Button)
- ✅ M-05 Motion QA (forhåndstilt, inkludert `transition-all`-kontroll og reducerert bevegelse)
- ✅ M-06 Governance (PR-krav i gang med denne leveransen)
