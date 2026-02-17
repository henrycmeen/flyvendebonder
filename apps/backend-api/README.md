# Backend API (SQLite)

Liten backend for kunde-/gårdsdata.

## Kjør
```bash
cd apps/backend-api
python3 server.py
```

Server starter på `http://127.0.0.1:8787`.

## Endepunkter
- `GET /health`
- `GET /api/users`
- `GET /api/users/<id>`
- `POST /api/users`
- `PUT /api/users/<id>`

## Seed
Ved første oppstart opprettes én bruker automatisk:
- Navn: `Roar Meen`
- Kommune: `3807` (Skien)
- Gårdsnummer: `70`
- Bruksnummer: `17`
- Festenummer: `0`

Adresse og telefon står tomt i starten og kan oppdateres med `PUT /api/users/<id>`.

## Eksempel
```bash
curl -s http://127.0.0.1:8787/api/users | jq
```
