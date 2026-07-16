from __future__ import annotations

from datetime import timedelta, timezone
from html import escape

from ..schemas import FieldReportOut


def _text(value: object | None) -> str:
    return escape("" if value is None else str(value), quote=True)


def _label(value: str, labels: dict[str, str]) -> str:
    return labels.get(value, value.replace("_", " "))


def _history_title(entry) -> str:
    if entry.kind == "capture" and entry.capture_id is not None and entry.title == f"Capture {entry.capture_id}":
        return f"Bildeserie {entry.capture_id}"
    if (
        entry.kind == "processing_run"
        and entry.processing_run_id is not None
        and entry.title == f"Processing run {entry.processing_run_id}"
    ):
        return f"Prosesseringsløp {entry.processing_run_id}"
    return entry.title


def _history_summary(entry) -> str:
    if entry.kind == "capture" and entry.photo_count is not None:
        return f"{entry.photo_count} bilder i bildeserien"
    return entry.summary


def _observed_at_label(finding) -> str:
    if finding.observed_at is None:
        return "Ukjent observasjonstid"

    observed_at = finding.observed_at
    observed_utc = (
        observed_at.replace(tzinfo=timezone.utc)
        if observed_at.tzinfo is None
        else observed_at.astimezone(timezone.utc)
    )
    original_offset = finding.observed_at_original_offset or "+00:00"
    try:
        sign = 1 if original_offset.startswith("+") else -1
        hours, minutes = original_offset[1:].split(":", maxsplit=1)
        offset_minutes = sign * ((int(hours) * 60) + int(minutes))
    except (AttributeError, TypeError, ValueError):
        original_offset = "+00:00"
        offset_minutes = 0
    observed_local = observed_utc + timedelta(minutes=offset_minutes)
    return f"Observasjonstid: {observed_local:%Y-%m-%d %H:%M} UTC{original_offset}"


def render_field_report_html(report: FieldReportOut) -> str:
    """Render a self-contained, script-free field report for printing."""
    summary = report.summary
    summary_items = (
        ("Oppdrag", summary.mission_count),
        ("Bildeserier", summary.capture_count),
        ("Prosesseringsløp", summary.processing_run_count),
        ("Leveranser", summary.delivery_count),
        ("Funn", summary.finding_count),
        ("Åpne funn", summary.open_finding_count),
        ("Nøkkelbilder", summary.key_photo_count),
    )
    summary_html = "".join(
        f'<div class="metric"><strong>{_text(value)}</strong><span>{_text(label)}</span></div>'
        for label, value in summary_items
    )

    findings_html = "".join(
        "".join(
            (
                '<article class="finding">',
                f"<h3>{_text(finding.title)}</h3>",
                f'<p class="meta">Status: {_text(_label(finding.status, {"open": "Åpen", "in_progress": "Pågår", "done": "Ferdig"}))} · '
                f'Prioritet: {_text(_label(finding.priority, {"low": "Lav", "normal": "Normal", "high": "Høy"}))}</p>',
                f'<p class="meta">{_text(_observed_at_label(finding))}</p>',
                f"<p>{_text(finding.notes)}</p>" if finding.notes else "",
                "</article>",
            )
        )
        for finding in report.findings
    ) or '<p class="empty">Ingen registrerte feltfunn.</p>'

    photos_html = "".join(
        "".join(
            (
                '<figure class="photo">',
                f'<img src="{_text(photo.web_url)}" alt="Nøkkelbilde {_text(photo.id)}">',
                f"<figcaption>{_text(photo.id)}</figcaption>",
                "</figure>",
            )
        )
        for photo in report.key_photos
    ) or '<p class="empty">Ingen nøkkelbilder er knyttet til funnene.</p>'

    history_html = "".join(
        "".join(
            (
                "<li>",
                f"<strong>{_text(_history_title(entry))}</strong>",
                f'<span class="meta">{_text(entry.occurred_at.date().isoformat())} · '
                f'{_text(_label(entry.kind, {"mission": "Oppdrag", "capture": "Bildeserie", "processing_run": "Prosesseringsløp"}))} · '
                f'{_text(_label(entry.status, {"draft": "Utkast", "ready": "Klar", "queued": "I kø", "running": "Pågår", "completed": "Fullført", "failed": "Feilet", "archived": "Arkivert", "cancelled": "Avbrutt"}))}</span>',
                f"<span>{_text(_history_summary(entry))}</span>",
                "</li>",
            )
        )
        for entry in report.history
    ) or '<li class="empty">Ingen historikk registrert.</li>'

    limitations_html = "".join(f"<li>{_text(item)}</li>" for item in report.limitations)
    artifact_kinds = ", ".join(summary.artifact_kinds) or "Ingen"
    property_label = report.property.label or f"{report.property.gnr}/{report.property.bnr}"
    matrikkelnummer = f"{report.property.komm}-{report.property.gnr}/{report.property.bnr}"
    if report.property.fnr:
        matrikkelnummer += f"/{report.property.fnr}"
    field_status = _label(report.field.status, {"draft": "Utkast", "confirmed": "Bekreftet"})
    field_source = _label(
        report.field.source,
        {"manual": "Manuelt registrert", "suggested": "Foreslått", "imported": "Importert"},
    )
    field_area = f"{report.field.area_ha:.2f} ha" if report.field.area_ha is not None else "Ikke beregnet"

    return f"""<!doctype html>
<html lang="nb">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{_text(report.title)}</title>
  <style>
    :root {{ color-scheme: light; font-family: system-ui, sans-serif; color: #172019; }}
    body {{ max-width: 960px; margin: 0 auto; padding: 2rem; line-height: 1.5; }}
    h1, h2, h3 {{ line-height: 1.2; }}
    .meta, .empty {{ color: #5c675f; }}
    .summary {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: .75rem; }}
    .metric, .finding {{ border: 1px solid #d7ded9; border-radius: .5rem; padding: .75rem; }}
    .metric strong, .metric span, .history span {{ display: block; }}
    .facts {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: .75rem; }}
    .facts div {{ border-bottom: 1px solid #d7ded9; padding-bottom: .5rem; }}
    .facts dt {{ color: #5c675f; font-size: .875rem; }}
    .facts dd {{ margin: .15rem 0 0; font-weight: 600; }}
    .photos {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; }}
    .photo {{ margin: 0; break-inside: avoid; }}
    .photo img {{ display: block; width: 100%; height: auto; border-radius: .35rem; }}
    .history {{ padding-left: 1.25rem; }}
    .history li {{ margin-bottom: .75rem; break-inside: avoid; }}
    section {{ margin-top: 2rem; }}
    @media (max-width: 480px) {{
      body {{ padding: 1.25rem; }}
      h1 {{ font-size: 1.75rem; }}
      .meta {{ overflow-wrap: break-word; }}
    }}
    @media print {{
      body {{ max-width: none; padding: 0; }}
      .metric, .finding {{ border-color: #999; }}
      section, .finding {{ break-inside: avoid; }}
    }}
  </style>
</head>
<body>
  <header>
    <p class="meta">Flyvendebønder · {_text(report.contract.name)} {_text(report.contract.version)}</p>
    <h1>{_text(report.title)}</h1>
    <p class="meta">Generert {_text(report.generated_at.isoformat())}</p>
  </header>
  <section>
    <h2>Feltgrunnlag</h2>
    <dl class="facts">
      <div><dt>Eiendom</dt><dd>{_text(property_label)}</dd></div>
      <div><dt>Matrikkel</dt><dd>{_text(matrikkelnummer)}</dd></div>
      <div><dt>Areal</dt><dd>{_text(field_area)}</dd></div>
      <div><dt>Feltstatus</dt><dd>{_text(field_status)}</dd></div>
      <div><dt>Kilde</dt><dd>{_text(field_source)}</dd></div>
    </dl>
  </section>
  <section>
    <h2>Oppsummering</h2>
    <div class="summary">{summary_html}</div>
    <p>Artefakttyper: {_text(artifact_kinds)}</p>
  </section>
  <section>
    <h2>Feltfunn</h2>
    {findings_html}
  </section>
  <section>
    <h2>Nøkkelbilder</h2>
    <div class="photos">{photos_html}</div>
  </section>
  <section>
    <h2>Historikk</h2>
    <ol class="history">{history_html}</ol>
  </section>
  <section>
    <h2>Begrensninger</h2>
    <ul>{limitations_html}</ul>
  </section>
</body>
</html>
"""
