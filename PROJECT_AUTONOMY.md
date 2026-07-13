---
project: "Flyvendebønder"
policy_version: 1
lifecycle_status: active
context: private
autonomy_level: A3
model_default: "Terra medium"
model_escalation: "Sol high"
canonical_url: "https://flyvendebønder.no/"
desired_url: null
---

# Prosjektautonomi

Codex kan finne og dokumentere små feil, velge avgrenset arbeid fra tidligste åpne GitHub-milestone, implementere, teste, pushe PR og merge når daily-loop-kontrakten, alle obligatoriske sjekker, uavhengig review og inline-kommentarer er grønne.

Kjør `./scripts/validate-agent-worktree.sh` for kodeendringer og også `./scripts/run-stack-smoke.sh` når frontend, routing, API, appnavigasjon, backendkontrakt eller import berøres. Produksjonsdeploy/restart, produksjonsdata, secrets, store UX-/produktvalg og fysisk feltaksept krever Henry. Bruk Terra high ved tvetydig flerfilsscope og Sol high for arkitektur, sikkerhet, migrering eller uavhengig sluttreview. Modellstyrke utvider aldri A3.
