"""Structured logger for Nexus Codex."""

from __future__ import annotations

import logging
import json
import sys
from datetime import datetime, timezone

from app.config import settings


class JsonFormatter(logging.Formatter):
    """JSON log formatter."""

    def format(self, record: logging.LogRecord) -> str:
        log_entry = {
            "level": record.levelname.lower(),
            "time": datetime.now(timezone.utc).isoformat(),
            "msg": record.getMessage(),
        }
        if hasattr(record, "extra_data") and record.extra_data:
            log_entry.update(record.extra_data)
        return json.dumps(log_entry)


class PrettyFormatter(logging.Formatter):
    """Pretty console formatter with colors."""

    COLORS = {
        "DEBUG": "\033[36m",  # cyan
        "INFO": "\033[32m",  # green
        "WARNING": "\033[33m",  # yellow
        "ERROR": "\033[31m",  # red
    }
    RESET = "\033[0m"
    DIM = "\033[2m"

    BADGES = {
        "DEBUG": "DBG",
        "INFO": "INF",
        "WARNING": "WRN",
        "ERROR": "ERR",
    }

    def format(self, record: logging.LogRecord) -> str:
        color = self.COLORS.get(record.levelname, "")
        badge = self.BADGES.get(record.levelname, record.levelname)
        time_str = datetime.now(timezone.utc).strftime("%H:%M:%S.%f")[:-3]
        msg = record.getMessage()

        extra_str = ""
        if hasattr(record, "extra_data") and record.extra_data:
            parts = []
            for k, v in record.extra_data.items():
                parts.append(f"\033[36m{k}\033[0m={v}")
            extra_str = " " + " ".join(parts)

        return (
            f"{self.DIM}{time_str}{self.RESET} "
            f"{color}{badge}{self.RESET} "
            f"{color}{msg}{self.RESET}"
            f"{extra_str}"
        )


def setup_logger() -> logging.Logger:
    """Set up the application logger."""
    log = logging.getLogger("nexus_codex")

    level_map = {
        "debug": logging.DEBUG,
        "info": logging.INFO,
        "warn": logging.WARNING,
        "warning": logging.WARNING,
        "error": logging.ERROR,
    }
    log.setLevel(level_map.get(settings.log_level, logging.INFO))

    handler = logging.StreamHandler(sys.stdout)
    if settings.log_format == "json":
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(PrettyFormatter())

    log.handlers = [handler]
    return log


logger = setup_logger()


class LoggerAdapter:
    """Adapter that allows passing extra data in log calls."""

    def __init__(self, log: logging.Logger):
        self._log = log

    def _log_with_extra(
        self, level: int, msg: str, extra: dict | None = None
    ) -> None:
        record = self._log.makeRecord(
            self._log.name,
            level,
            "(unknown)",
            0,
            msg,
            (),
            None,
        )
        record.extra_data = extra or {}  # type: ignore[attr-defined]
        self._log.handle(record)

    def debug(self, msg: str, extra: dict | None = None) -> None:
        self._log_with_extra(logging.DEBUG, msg, extra)

    def info(self, msg: str, extra: dict | None = None) -> None:
        self._log_with_extra(logging.INFO, msg, extra)

    def warn(self, msg: str, extra: dict | None = None) -> None:
        self._log_with_extra(logging.WARNING, msg, extra)

    def error(self, msg: str, extra: dict | None = None) -> None:
        self._log_with_extra(logging.ERROR, msg, extra)


log = LoggerAdapter(logger)
