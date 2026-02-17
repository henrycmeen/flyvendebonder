# Deploy-flyt for flyvendebønder.no

## Forutsetninger
- SSH alias `macmini` fungerer.
- Remote webroot finnes: `/Users/henrymeen/srv/www/flyvendebonder/`.

## Staging
Bygg en lokal staging-kopi med riktig URL-struktur:
- infoside på `/`
- demo på `/demo/`

```bash
./scripts/prepare-webroot.sh
```

Resultat i:
- `.staging/webroot/index.html`
- `.staging/webroot/demo/index.html`

## Deploy
### Dry-run
```bash
./scripts/deploy-flyvendebonder.sh --dry-run
```

### Faktisk deploy
```bash
./scripts/deploy-flyvendebonder.sh
```

## Nyttige valg
- Lokal sync (uten SSH):
  ```bash
  ./scripts/deploy-flyvendebonder.sh --local --dest /tmp/flyv-webroot/
  ```
- Egendefinert host/user:
  ```bash
  ./scripts/deploy-flyvendebonder.sh --host macmini --user henrymeen
  ```
