from __future__ import annotations

import shutil
from pathlib import Path

from PIL import Image

from ..config import get_settings

settings = get_settings()

WEB_MAX_SIDE = 1600
WEB_JPEG_QUALITY = 82
THUMB_MAX_SIDE = 384
THUMB_JPEG_QUALITY = 72

SUPPORTED_ORIGINAL_EXTS = {".jpg", ".jpeg", ".tif", ".tiff"}


def ensure_photo_dirs() -> None:
    photos_root = settings.app_data_root / "photos"
    for sub in ("original", "web", "thumb"):
        (photos_root / sub).mkdir(parents=True, exist_ok=True)


def _normalized_original_ext(source: Path) -> str:
    ext = source.suffix.lower()
    if ext in SUPPORTED_ORIGINAL_EXTS:
        return ext
    return ".jpg"


def _original_mime_from_ext(ext: str) -> str:
    if ext in {".tif", ".tiff"}:
        return "image/tiff"
    return "image/jpeg"


def write_derivatives(source: Path, source_hash: str) -> list[dict]:
    ensure_photo_dirs()

    ext = _normalized_original_ext(source)
    original_rel = Path("photos") / "original" / f"{source_hash}{ext}"
    web_rel = Path("photos") / "web" / f"{source_hash}.jpg"
    thumb_rel = Path("photos") / "thumb" / f"{source_hash}.jpg"

    original_abs = settings.app_data_root / original_rel
    web_abs = settings.app_data_root / web_rel
    thumb_abs = settings.app_data_root / thumb_rel

    if not original_abs.exists():
        original_abs.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, original_abs)

    with Image.open(source) as image:
        web_img = image.copy()
        web_img.thumbnail((WEB_MAX_SIDE, WEB_MAX_SIDE))
        web_img.convert("RGB").save(
            web_abs,
            format="JPEG",
            quality=WEB_JPEG_QUALITY,
            optimize=True,
            progressive=True,
        )
        web_size = web_img.size

        thumb_img = image.copy()
        thumb_img.thumbnail((THUMB_MAX_SIDE, THUMB_MAX_SIDE))
        thumb_img.convert("RGB").save(
            thumb_abs,
            format="JPEG",
            quality=THUMB_JPEG_QUALITY,
            optimize=True,
            progressive=True,
        )
        thumb_size = thumb_img.size

    return [
        {
            "kind": "original",
            "path": original_rel.as_posix(),
            "mime": _original_mime_from_ext(ext),
            "bytes": original_abs.stat().st_size,
            "width": None,
            "height": None,
        },
        {
            "kind": "web",
            "path": web_rel.as_posix(),
            "mime": "image/jpeg",
            "bytes": web_abs.stat().st_size,
            "width": web_size[0],
            "height": web_size[1],
        },
        {
            "kind": "thumb",
            "path": thumb_rel.as_posix(),
            "mime": "image/jpeg",
            "bytes": thumb_abs.stat().st_size,
            "width": thumb_size[0],
            "height": thumb_size[1],
        },
    ]
