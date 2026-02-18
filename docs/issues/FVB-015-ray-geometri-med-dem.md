# FVB-015 – DEM-inspirert view-line og “kamera ser” beregning

## Målet
Gjøre valget av hva kamera ser mer robust ved å forberede vei for DEM-baserte ray-interseksjoner og beholde dagens flat-Earth-metode som fallback.

## Område
Geometri og usikkerhet (FVB-009).

## Status
På gang (inspirasjon/arkitektur).

## Inspirasjon
- [Theta-Limited/OpenAthena-Legacy-Python](https://github.com/Theta-Limited/OpenAthena-Legacy-Python) (LGPL-2.1): ray-cast/linje mot terreng-logikk med offline DEM.
- [jgcmeteo/photogeoref](https://github.com/jgcmeteo/photogeoref) (MIT): oblique georeferering mot DEM.
- [luipir/image_footprint_code_recompilation](https://github.com/luipir/image_footprint_code_recompilation) (GPL): ray-baserte footprint-hjørner.

## Oppdaget i koden vår i dag
- `apps/backend-api/app/services/geometry_utils.py` bruker projeksjon uten DEM:
  - estimerer `forward_distance = h / tan(pitch)`,
  - flytter punktet planimetrisk med yaw.
- `apps/backend-api/app/services/photos.py` og `scripts/photo_qc_report.py` bygger analyse-sone rundt estimert punkt, men ikke mot terrengprofil.
- UI i `apps/web-app/src/components/photo-map-inset.tsx` og `map-canvas.tsx` visualiserer view-line og usikkerhet allerede.

## Forslag (inspirasjonsdrevet)
- Implementer et eget lag:
  1. `choose_geometry_flat` (eksisterende oppførsel) beholdes.
  2. `choose_geometry_dtm` (ny) med DEM-rastersjekk når tilgjengelig.
  3. `geometry_method` flagger hvilken metode som brukes (`flat`, `estimated`, `estimated_dtm`).
  4. Dersom DEM-profil avviker mye (f.eks. terrengbratt eller for lange avstander), nedgrader `confidence_score` + legg til `qc:geometry_dtm_degraded`.
- Reuse eksisterende `view_mode` + `location_uncertainty_m` felt slik at UI-behoven vises uten nye felt.

## Akseptanse
- Valget av metode (`flat` vs `estimated_dtm`) er eksplisitt i API-respons.
- DEM brukes kun når datakilde finnes og kvalitetssjekker tillater det.
- Ved DEM-tilgjengelighet reduseres antall urealistiske view-hits markert som `estimated` i skråbilder.
- Alle dagens felt (`view_lat`, `view_lng`, `location_uncertainty_m`, `confidence_score`) fortsetter å være kompatible.
