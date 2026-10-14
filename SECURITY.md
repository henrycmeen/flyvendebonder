# Sikkerhet

## Privat rapportering

Bruk GitHubs private sårbarhetsrapportering på repoets Security-side når den
er tilgjengelig. Ikke opprett en offentlig issue med hemmeligheter, exploit
eller personopplysninger. Hvis privat rapportering ikke er tilgjengelig,
be maintainer om en privat kanal uten å publisere selve funnet.

Oppgi berørt commit, forutsetninger, minste reproduksjon med syntetiske data og
mulig konsekvens. Bare siste hovedgren vedlikeholdes; prosjektet har foreløpig
ingen avtalt sikkerhets-SLA.

## Skille mellom offentlig kode og drift

Offentlig kode gir ingen tilgang til maintainers Mac, SSH, nøkkelring,
databaser eller produksjonsmiljø. CI for eksterne bidrag skal kjøres på
isolerte GitHub-hostede maskiner, med lesetilgang som standard og uten
produksjonshemmeligheter. Repoet skal ikke ha registrerte self-hosted runners
på maintainers personlige maskiner.

Produksjonsdeploy er en separat, eksplisitt maintainerhandling. Den eksisterende
self-hosted deploy-workflowen er deaktivert i GitHub før offentliggjøring og må
ikke aktiveres på nytt mot en personlig maskin.

## Før offentliggjøring og releases

Kontroller publiserte Git-refs/historikk, Actions-logger og artefakter, issues,
PR-er og releases for hemmeligheter. Roter en aktiv hemmelighet før eventuell
historikksanering. Vurder også metadata og datarettigheter; en secrets-scan
alene er ikke en full sikkerhetsrevisjon.

Flyvendebønder er under utvikling og erstatter ikke faglig vurdering,
flysikkerhetskontroll eller offisielle regelverkskilder.
