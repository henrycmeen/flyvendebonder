# Bidra til Flyvendebønder

Vi ønsker bønder, dronebrukere, utviklere og fagmiljøer velkommen til å gjøre
Flyvendebønder nyttig under norske forhold. Prosjektet er tidlig i utviklingen;
forslag og feilrapporter er like nyttige som kode.

## Begynn med et konkret behov

Søk i GitHub Issues først. Beskriv hvem problemet gjelder, hva du forsøkte,
forventet og faktisk resultat, og en liten reproduksjon. Diskuter større
endringer før implementering. Bruk syntetiske data i feilrapporter.

## Kodebidrag

Prosjektets egen kode bruker [MIT](LICENSE). Send bare kode du har rett til å
bidra med under den lisensen, og behold tredjeparts lisensmerknader. Bilder og
data følger [egne rettighetsregler](DATA_RIGHTS.md).

Hold én tydelig leveranse per pull request. Beskriv praktisk nytte, relevante
kontroller og kjente begrensninger. Følg [README](README.md) for lokalt oppsett.
Kjør `./scripts/validate-agent-worktree.sh` ved kodeendringer, og
`./scripts/run-stack-smoke.sh` når samspillet mellom frontend og API berøres.
Små dokumentasjonsendringer trenger kontroll av tekst, lenker og diff.

En AI-generert endring må forstås og kontrolleres av den som sender den.
Maintainer avgjør merge. Ingen bidrag får automatisk tilgang til produksjon,
en maintainer-maskin eller private data.

## Sikkerhet

Følg [SECURITY.md](SECURITY.md). Ikke legg hemmeligheter, private logger eller
personopplysninger i offentlige issues eller pull requests.
