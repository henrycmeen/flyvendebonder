# UI-audit M2

Dette er en repo-naer status for M2-epic #31: `Designsystem v2 - shadcn-first + Flyvendebonder liquid layer`.

## Scope

- `apps/web-app` er primarflaten for M2.
- `apps/info-site` er koblet pa via token-bridge, men appen er designkilden.
- Skjermkontrakter for `Kart`, `Album`, `Import` og `Fotoinspektor` ligger i `docs/skjermkontrakter-v1.md`.

## Baseline per flate

| Flate | Status | M2-kontrakt | Gjenstaende |
| --- | --- | --- | --- |
| Kart | Aktiv arbeidsflate med egne filter- og lagpaneler. | Kontroller skal vaere sma, kontekstuelle og tokeniserte. | Videre rydde hardkodede kart-/panel-klasser og sikre tomtilstandscopy. |
| Album | Har sok, sesong-/arstokens, nyeste-forst og fotoinspektor-overgang. | Albumet er gjenfinningsflate, ikke metadataredigering. | Bytte lokale tomtilstander til felles `EmptyState` nar flaten endres. |
| Import | Egen browserimportflate via media-staging. | Import eier inntak og bekreftelse for bildefiler. | Fortsette copy- og feilstate-rydding nar importflyten endres. |
| Fotoinspektor | Ekstrahert ut av `App.tsx` som egen container i M2. | Beslutningsflate for ett bilde med metadata, analyse og kartutsnitt. | Gradvis migrere input-/alert-/empty-states til felles UI-primitives. |
| Info-site | Token-bridge og light-only app-sprak er etablert. | Skal folge appens tokens uten total redesign. | Rydde rester av legacy CSS nar infosiden endres. |

## Core UI inventory

| Komponent | Status | Notat |
| --- | --- | --- |
| `Button` | Pa plass | Tokenisert motion, loading og success/error state. |
| `Input` | Pa plass | Tokenisert focus, disabled og error/success state. |
| `Textarea` | Pa plass | Speiler `Input`-kontrakten for lengre tekstfelt. |
| `Card` | Pa plass | Bruker felles surface/border/shadow. |
| `Tabs` | Pa plass | Tokenisert active/focus/motion. |
| `Dialog` | Pa plass | Tokenisert overlay/panel og motion. |
| `Sheet` | Pa plass | Brukes som drawer-lignende primitive. |
| `Switch` | Pa plass | Tokenisert checked/unchecked/focus. |
| `Alert` | Pa plass | Default/success/warning/error-varianter. |
| `Skeleton` | Pa plass | Motion-reduce-stotte. |
| `EmptyState` | Pa plass | Felles tomtilstand for kjerneflater. |
| `Label`, `Tooltip`, `ScrollArea` | Pa plass | Migrert til `fb-*` tokenlag. |

## Auditfunn

1. #31 er ikke trygg a lukke bare pa grunn av core primitives. Epicen eier fortsatt governance, screenshots og migrering av eksisterende flater.
2. `docs/design-system-v2-token-v0.md` viser at token-, motion- og infosidearbeidet er langt kommet, men status er historisk og trenger fortsatt en sluttkommentar pa #31 for hva som er igjen.
3. Det finnes fortsatt hardkodede visuelle verdier i eldre komponentklasser. Det er akseptabelt for eksisterende debt, men nye UI-endringer bor bruke `fb-*` tokens eller dokumentere hvorfor de avviker.
4. Screenshot-kravet bor handteres per UI-endrings-PR. Denne core-primitive-slicen endrer ingen synlig flate direkte.

## Neste lukking av M2

- `CloseButton` er tokenisert uten lokale farge-/gradientliterals.
- Album og import bruker felles `EmptyState` for reelle tomtilstander, med desktop- og mobilskjermbilder i `docs/ui-audit/screens/`.
- Kommenter #31 med denne auditstatusen og lukk epicen forst nar de siste praktiske governancepunktene er enten levert eller flyttet til konkrete issues.
