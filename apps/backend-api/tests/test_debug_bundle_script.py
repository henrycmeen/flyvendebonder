from __future__ import annotations

import os
import subprocess
import tarfile
from pathlib import Path


def test_debug_bundle_includes_incident_summary(tmp_path: Path) -> None:
    repo_root = Path(__file__).resolve().parents[3]
    script = repo_root / "scripts" / "debug-bundle.sh"

    secret_values = {
        "DATABASE_URL": "postgresql://debug-user:database-secret@example.invalid/flyvendebonder",
        "ADMIN_ACCESS_CODE": "synthetic-admin-code-secret",
        "VITE_API_SECRET": "synthetic-vite-secret",
        "FB_SESSION_TOKEN": "synthetic-session-token",
    }
    result = subprocess.run(
        ["bash", str(script), str(tmp_path), "12"],
        cwd=repo_root,
        check=True,
        capture_output=True,
        text=True,
        timeout=30,
        env={**os.environ, **secret_values},
    )

    assert "Debug bundle skrevet:" in result.stdout
    bundles = sorted(tmp_path.glob("flyvendebonder-debug-*.tgz"))
    assert len(bundles) == 1

    with tarfile.open(bundles[0], "r:gz") as archive:
        names = archive.getnames()
        incident_summary_name = next(name for name in names if name.endswith("/incident-summary.txt"))
        incident_summary = archive.extractfile(incident_summary_name)
        assert incident_summary is not None
        content = incident_summary.read().decode("utf-8")

        privacy_notice_name = next(name for name in names if name.endswith("/privacy-notice.txt"))
        privacy_notice = archive.extractfile(privacy_notice_name)
        assert privacy_notice is not None
        privacy_content = privacy_notice.read().decode("utf-8")

        archive_text = "\n".join(
            archive.extractfile(name).read().decode("utf-8", errors="replace")
            for name in names
            if archive.getmember(name).isfile()
        )

    assert "Source: docs/debug/incidents" in content
    assert "map-filter-photo-load-fail.md" in content
    assert "TEMPLATE.md" not in content
    assert "slug: photo-henting-feiler-under-filter" in content
    assert "reported_by: stabilitetsrunde" in content
    assert "issue: unknown" in content
    assert "Classification: confidential operational data" in privacy_content
    assert "Delete no later than: 7 days after generation" in privacy_content
    assert "Do not attach to public issues" in privacy_content
    for key, value in secret_values.items():
        assert key not in archive_text
        assert value not in archive_text
