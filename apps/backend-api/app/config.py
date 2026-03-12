from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


BASE_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Flyvendebonder API"
    env: str = "dev"
    api_prefix: str = "/api/v1"
    host: str = "127.0.0.1"
    port: int = 8787
    log_level: str = "INFO"
    log_to_console: bool = True
    log_to_file: bool = True
    log_file_path: Path = BASE_DIR / "logs" / "backend.log"
    log_file_max_bytes: int = 20 * 1024 * 1024
    log_file_backup_count: int = 14

    database_url: str = f"sqlite:///{(BASE_DIR / 'data' / 'flyvendebonder.db').as_posix()}"

    app_data_root: Path = BASE_DIR / "storage"
    photos_root: Path = BASE_DIR / "storage" / "photos"
    imports_default_source: Path = Path("/Users/henmee/Movies/Droneshots/Meen gård/Analysebilder")

    demo_seed_geojson: Path = REPO_ROOT / "apps" / "demo-fotokart" / "data" / "photos.geojson"
    demo_seed_assets_dir: Path = REPO_ROOT / "apps" / "demo-fotokart" / "assets" / "photos"

    nibio_job_ttl_hours: int = 24 * 6
    nibio_gpiareastat_url: str = "https://kart17.nibio.no/gardskart_ws_04/gpiareastat"

    default_user_name: str = "Roar Meen"
    default_municipality_code: str = "4003"
    default_municipality_name: str = "Skien"
    default_gnr: int = 70
    default_bnr: int = 17
    default_fnr: int = 0
    admin_access_code: str = ""
    admin_session_secret: str = ""
    admin_session_cookie_name: str = "flyvendebonder_admin"
    admin_session_ttl_hours: int = 12

    photo_analysis_enabled: bool = True
    photo_ar5_wms_url: str = "https://wms.nibio.no/cgi-bin/ar5"
    photo_ar5_wms_layers: str = "Arealtype"
    photo_ar5_wms_layer_fields: str = "artype_beskrivelse,vanlig_beskrivelse,enkel_beskrivelse,artype"
    photo_ar5_wfs_url: str = ""
    photo_ar5_wfs_layers: str = ""
    photo_ar5_layer_fields: str = "ar5klasse,AR5KLASSE,AR5_KLASSE,KLASSE,KLASSENAVN,KLASSETYPE"
    photo_soil_wms_url: str = "https://wms.nibio.no/cgi-bin/jordkvalitet"
    photo_soil_wms_layers: str = "Jordkvalitet"
    photo_soil_wms_layer_fields: str = "jordkvalitet_t,jordkvalitet,metodikk"
    photo_soil_wfs_url: str = "https://wfs.nibio.no/cgi-bin/jordkvalitet"
    photo_soil_wfs_layers: str = "ms:Jordkvalitet"
    photo_soil_layer_fields: str = "jordkvalitet_t,jordkvalitet,jordtype,SOIL_TYPE,JORDTYPE,JORDKLASSE,KLASSE,KLASSENAVN,soil_type"
    photo_analysis_lookup_radius_deg: float = 0.00018
    photo_analysis_wms_query_radius_deg: float = 0.0002
    photo_analysis_http_timeout_seconds: float = 20.0


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
