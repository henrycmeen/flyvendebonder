from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


BASE_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = Path(__file__).resolve().parents[3]
DEPLOYED_WEBROOT_APP = Path("/Users/henrymeen/srv/www/flyvendebonder/app")
DEPLOYED_ORTHOPHOTO_OVERLAY_ROOT = DEPLOYED_WEBROOT_APP / "dev-overlays"
LOCAL_ORTHOPHOTO_OVERLAY_ROOT = REPO_ROOT / "apps" / "web-app" / "public" / "dev-overlays"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Flyvendebonder API"
    env: str = "dev"
    api_prefix: str = "/api/v1"
    host: str = "127.0.0.1"
    port: int = 8787

    # Browsers serialize IDN hosts to punycode in the Origin header, so both the
    # ASCII domain and the punycode form of flyvendebønder.no are listed.
    cors_allow_origins: list[str] = [
        "https://flyvendebonder.no",
        "https://www.flyvendebonder.no",
        "https://xn--flyvendebnder-jnb.no",
        "https://www.xn--flyvendebnder-jnb.no",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]
    log_level: str = "INFO"
    log_to_console: bool = True
    log_to_file: bool = True
    log_file_path: Path = BASE_DIR / "logs" / "backend.log"
    log_file_max_bytes: int = 20 * 1024 * 1024
    log_file_backup_count: int = 14

    database_url: str = f"sqlite:///{(BASE_DIR / 'data' / 'flyvendebonder.db').as_posix()}"

    app_data_root: Path = BASE_DIR / "storage"
    photos_root: Path | None = None
    imports_default_source: Path = Path("/Users/henmee/Movies/Droneshots/Meen gård/Analysebilder")

    demo_seed_geojson: Path = REPO_ROOT / "apps" / "demo-fotokart" / "data" / "photos.geojson"
    demo_seed_assets_dir: Path = REPO_ROOT / "apps" / "demo-fotokart" / "assets" / "photos"

    nibio_job_ttl_hours: int = 24 * 6
    nibio_gardskart_enabled: bool = False
    nibio_gpiareastat_url: str = "https://kart17.nibio.no/gardskart_ws_04/gpiareastat"
    geonorge_eiendom_api_url: str = "https://ws.geonorge.no/eiendom/v1"
    geonorge_http_timeout_seconds: float = 20.0
    geonorge_point_lookup_radius_m: int = 75
    geonorge_point_lookup_max_hits: int = 25
    terrain_dem_image_server_url: str = "https://hoydedata.no/arcgis/rest/services/DTM/ImageServer"
    terrain_http_timeout_seconds: float = 20.0
    terrain_sample_batch_size: int = 200
    orthophoto_overlay_root: Path = DEPLOYED_ORTHOPHOTO_OVERLAY_ROOT

    default_user_name: str = "Roar Meen"
    default_municipality_code: str = "4003"
    default_municipality_name: str = "Skien"
    default_gnr: int = 70
    default_bnr: int = 17
    default_fnr: int = 0
    admin_user_id: int | None = None
    admin_access_open: bool = False
    admin_access_code: str = ""
    admin_session_secret: str = ""
    admin_session_cookie_name: str = "flyvendebonder_admin"
    admin_session_ttl_hours: int = 12

    photo_analysis_enabled: bool = True
    photo_ar5_enabled: bool = False
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

    def model_post_init(self, __context) -> None:
        if self.photos_root is None:
            self.photos_root = self.app_data_root / "photos"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
