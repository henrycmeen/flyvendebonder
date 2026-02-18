from __future__ import annotations

import logging
import re
from collections import deque
from contextvars import ContextVar
from logging.handlers import RotatingFileHandler
from pathlib import Path

from .config import get_settings


request_id_ctx: ContextVar[str] = ContextVar("request_id", default="-")


class RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_ctx.get("-")
        return True


def _parse_level_filter(level: str | None) -> str | None:
    if not level:
        return None
    normalized = level.strip().upper()
    return normalized if normalized else None


_LOG_LINE_RE = re.compile(
    r"^(?P<timestamp>\S+ \S+) (?P<level>[A-Z]+) (?P<logger>[^ ]+) \[req=(?P<request_id>[^\]]+)\] (?P<message>.*)$"
)


def _configure_handler(handler: logging.Handler, formatter: logging.Formatter, req_filter: RequestIdFilter) -> None:
    handler.setFormatter(formatter)
    if req_filter not in handler.filters:
        handler.addFilter(req_filter)


def _read_lines(path: Path, limit: int) -> list[str]:
    if not path.exists():
        return []

    with path.open("r", encoding="utf-8", errors="replace") as handle:
        return list(deque(handle, maxlen=max(1, limit)))


def configure_logging(level: str = "INFO") -> None:
    settings = get_settings()
    log_level = getattr(logging, level.upper(), logging.INFO)

    formatter = logging.Formatter(
        "%(asctime)s %(levelname)s %(name)s [req=%(request_id)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S,%f",
    )
    req_filter = RequestIdFilter()

    root = logging.getLogger()
    root.setLevel(log_level)

    if settings.log_to_console:
        if not root.handlers:
            logging.basicConfig(level=log_level)
        for handler in root.handlers:
            handler.setLevel(log_level)
            _configure_handler(handler, formatter, req_filter)

    if settings.log_to_file:
        log_path = settings.log_file_path
        log_path.parent.mkdir(parents=True, exist_ok=True)

        file_handler_exists = any(
            isinstance(handler, RotatingFileHandler)
            and Path(handler.baseFilename).resolve() == log_path.resolve()
            for handler in root.handlers
        )

        if not file_handler_exists:
            file_handler = RotatingFileHandler(
                log_path,
                maxBytes=max(1, settings.log_file_max_bytes),
                backupCount=max(0, settings.log_file_backup_count),
            )
            file_handler.setLevel(log_level)
            _configure_handler(file_handler, formatter, req_filter)
            root.addHandler(file_handler)


def read_recent_logs(limit: int = 200, level: str | None = None) -> list[dict[str, str | None]]:
    settings = get_settings()
    level_filter = _parse_level_filter(level)

    entries = _read_lines(settings.log_file_path, limit)
    out: list[dict[str, str | None]] = []

    for raw in entries:
        text = raw.rstrip("\n")
        match = _LOG_LINE_RE.match(text)

        if match is None:
            out.append(
                {
                    "timestamp": "",
                    "level": "",
                    "logger": "",
                    "request_id": None,
                    "message": text,
                    "raw": text,
                }
            )
            continue

        record_level = match.group("level").upper()
        if level_filter is not None and record_level != level_filter:
            continue

        out.append(
            {
                "timestamp": match.group("timestamp"),
                "level": record_level,
                "logger": match.group("logger"),
                "request_id": match.group("request_id"),
                "message": match.group("message"),
                "raw": text,
            }
        )

    return out[::-1]
