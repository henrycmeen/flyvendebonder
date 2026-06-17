from __future__ import annotations

import subprocess
import tarfile
from pathlib import Path


def test_debug_bundle_includes_incident_summary(tmp_path: Path) -> None:
    repo_root = Path(__file__).resolve().parents[3]
    script = repo_root / "scripts" / "debug-bundle.sh"

    result = subprocess.run(
        ["bash", str(script), str(tmp_path), "12"],
        cwd=repo_root,
        check=True,
        capture_output=True,
        text=True,
        timeout=30,
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

    assert "Source: docs/debug/incidents" in content
    assert "map-filter-photo-load-fail.md" in content
    assert "TEMPLATE.md" not in content
    assert "slug: photo-henting-feiler-under-filter" in content
    assert "reported_by: stabilitetsrunde" in content
    assert "issue: unknown" in content
