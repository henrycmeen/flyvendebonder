# Lokal prosjektlagring

Flyvendebønder bruker en delt modell på privat Mac mini:

- Git-repo, `.git`, aktiv kildekode og lokale endringer ligger på intern SSD.
- Store prosjektdata og runtime-cacher ligger på APFS-volumet `Projects`.
- Reporoten får en lokal snarvei, `project-storage/`, som peker til den eksterne prosjektroten.

## Oppsett

Monter `Projects`-disken og kjør fra reporoten:

```bash
./scripts/setup-project-storage-link.sh
```

Standardmålet er `/Volumes/Projects/Active/Flyvendebonder`. Et annet mål kan oppgis eksplisitt:

```bash
./scripts/setup-project-storage-link.sh /annen/sti/Flyvendebonder
```

Skriptet overskriver aldri en eksisterende fil, mappe eller symlink. `project-storage/` er ignorert av Git fordi selve lenken er maskinlokal.

## Struktur

```text
project-storage/
├── data/             store datasett og importgrunnlag
├── media/            dronebilder og video
├── exports/          genererte leveranser
└── runtime-caches/   node_modules og virtuelle Python-miljøer
```

Eksisterende `node_modules`- og `.venv`-stier kan være symlinker til undermapper i `runtime-caches/`. Disse lenkene må ikke erstattes med nye interne cacher bare fordi disken midlertidig er frakoblet.

## Sikker bruk

Før installasjon, build, test eller smoke:

1. Kontroller at `/Volumes/Projects` er montert.
2. Kontroller at `project-storage/` løser til forventet prosjektrot.
3. Kontroller at relevante `node_modules`- og `.venv`-lenker ikke er dangling.

Hvis en lenke er brutt, stopp og monter riktig disk. Ekstern prosjektlagring er arbeidslagring, ikke en fullverdig sikkerhetskopi; uerstattelige rådata og medier skal også finnes på et separat lagringssted.
