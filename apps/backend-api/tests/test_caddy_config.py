from __future__ import annotations

from pathlib import Path


def test_photo_asset_cache_headers_stay_private_at_proxy() -> None:
    repo_root = Path(__file__).resolve().parents[3]
    config = (repo_root / "scripts" / "caddy" / "flyvendebonder.Caddyfile.snippet").read_text(
        encoding="utf-8"
    )

    assert 'Cache-Control "public,' not in config
    assert 'Cache-Control "private, max-age=31536000, immutable"' in config
    assert 'Cache-Control "private, max-age=3600"' in config
