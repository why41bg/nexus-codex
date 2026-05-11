"""Structured logger for Nexus Codex.

Provides:
- ``PrettyFormatter`` / ``JsonFormatter`` — for the app's own ``nexus_codex`` logger
- ``NexusDefaultFormatter`` / ``NexusAccessFormatter`` — for Uvicorn's loggers
- ``get_log_config()`` — dictConfig for Uvicorn so its output matches the app's style
- ``log`` — the ready-to-use LoggerAdapter instance
"""

from __future__ import annotations

import http
import json
import logging
import sys
from copy import copy
from datetime import datetime

from app.config import settings

# ── Shared style constants ───────────────────────────────────────────

_IS_TTY = sys.stdout.isatty()

_COLORS: dict[str, str] = {
    "DEBUG": "\033[36m",
    "INFO": "\033[32m",
    "WARNING": "\033[33m",
    "ERROR": "\033[31m",
    "CRITICAL": "\033[31m",
}
_RESET = "\033[0m"
_DIM = "\033[2m"

_BADGES: dict[str, str] = {
    "DEBUG": "DBG",
    "INFO": "INF",
    "WARNING": "WRN",
    "ERROR": "ERR",
    "CRITICAL": "ERR",
}

_STATUS_COLORS: dict[int, str] = {
    2: "\033[32m",
    3: "\033[36m",
    4: "\033[33m",
    5: "\033[31m",
}

_LEVEL_MAP: dict[str, int] = {
    "debug": logging.DEBUG,
    "info": logging.INFO,
    "warn": logging.WARNING,
    "warning": logging.WARNING,
    "error": logging.ERROR,
}


def _fmt_line(levelname: str, message: str) -> str:
    """Format a single log line: ``timestamp BADGE message``."""
    badge = _BADGES.get(levelname, levelname)
    time_str = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    if not _IS_TTY:
        return f"{time_str} {badge} {message}"
    color = _COLORS.get(levelname, "")
    return (
        f"{_DIM}{time_str}{_RESET} "
        f"{color}{badge}{_RESET} "
        f"{color}{message}{_RESET}"
    )


# ── App formatters ───────────────────────────────────────────────────


class JsonFormatter(logging.Formatter):
    """JSON log formatter for machine consumption.

    Extra data is placed under a dedicated ``context`` key to avoid
    collisions with top-level fields like ``level`` or ``time``.
    """

    def format(self, record: logging.LogRecord) -> str:
        log_entry: dict = {
            "level": record.levelname.lower(),
            "time": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
            "msg": record.getMessage(),
            "caller": f"{record.pathname}:{record.lineno}",
            "function": record.funcName,
        }
        if hasattr(record, "extra_data") and record.extra_data:
            log_entry["context"] = record.extra_data
        return json.dumps(log_entry, ensure_ascii=False)


class PrettyFormatter(logging.Formatter):
    """Pretty console formatter with colored badges."""

    def format(self, record: logging.LogRecord) -> str:
        msg = record.getMessage()

        extra_str = ""
        if hasattr(record, "extra_data") and record.extra_data:
            if _IS_TTY:
                parts = [f"\033[36m{k}\033[0m={v}" for k, v in record.extra_data.items()]
            else:
                parts = [f"{k}={v}" for k, v in record.extra_data.items()]
            extra_str = " " + " ".join(parts)

        return _fmt_line(record.levelname, msg) + extra_str


# ── Uvicorn formatters ───────────────────────────────────────────────


class NexusDefaultFormatter(logging.Formatter):
    """Formatter for ``uvicorn`` / ``uvicorn.error``, matching PrettyFormatter."""

    def format(self, record: logging.LogRecord) -> str:
        return _fmt_line(record.levelname, record.getMessage())


class NexusAccessFormatter(logging.Formatter):
    """Formatter for ``uvicorn.access`` in the app's style.

    Uvicorn passes request info as ``record.args``:
    ``(client_addr, method, full_path, http_version, status_code)``
    """

    def format(self, record: logging.LogRecord) -> str:
        recordcopy = copy(record)
        client_addr, method, full_path, _http_version, status_code = recordcopy.args

        status = int(status_code)
        try:
            phrase = http.HTTPStatus(status).phrase
        except ValueError:
            phrase = ""

        if status >= 500:
            levelname = "ERROR"
        elif status >= 400:
            levelname = "WARNING"
        else:
            levelname = record.levelname

        if _IS_TTY:
            sc = _STATUS_COLORS.get(status // 100, "")
            status_str = f"{sc}{status} {phrase}{_RESET}"
            message = f"{method} {full_path} → {status_str}  {_DIM}({client_addr}){_RESET}"
        else:
            status_str = f"{status} {phrase}"
            message = f"{method} {full_path} → {status_str}  ({client_addr})"
        return _fmt_line(levelname, message)


# ── Uvicorn log config ───────────────────────────────────────────────


def get_log_config() -> dict:
    """Return a ``dictConfig`` for Uvicorn so its output matches the app's style."""
    uvicorn_level = _LEVEL_MAP.get(settings.log_level, logging.INFO)
    return {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "default": {
                "()": "app.utils.logger.NexusDefaultFormatter",
            },
            "access": {
                "()": "app.utils.logger.NexusAccessFormatter",
            },
        },
        "handlers": {
            "default": {
                "formatter": "default",
                "class": "logging.StreamHandler",
                "stream": "ext://sys.stdout",
            },
            "access": {
                "formatter": "access",
                "class": "logging.StreamHandler",
                "stream": "ext://sys.stdout",
            },
        },
        "loggers": {
            "uvicorn": {
                "handlers": ["default"],
                "level": uvicorn_level,
                "propagate": False,
            },
            "uvicorn.error": {
                "handlers": ["default"],
                "level": uvicorn_level,
                "propagate": False,
            },
            "uvicorn.access": {
                "handlers": ["access"],
                "level": logging.WARNING,
                "propagate": False,
            },
        },
    }


# ── App logger setup ─────────────────────────────────────────────────


def _setup_logger() -> logging.Logger:
    logger = logging.getLogger("nexus_codex")
    logger.setLevel(_LEVEL_MAP.get(settings.log_level, logging.INFO))

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter() if settings.log_format == "json" else PrettyFormatter())
    logger.handlers = [handler]
    return logger


class LoggerAdapter:
    """Adapter that allows passing extra data in log calls.

    Uses ``stacklevel=2`` so the log record captures the actual caller's
    file, line number, and function name instead of pointing into this adapter.
    """

    def __init__(self, log: logging.Logger):
        self._log = log

    def _log_with_extra(self, level: int, msg: str, extra: dict | None = None) -> None:
        # stacklevel=2: skip _log_with_extra + the public method (debug/info/...)
        # so the record points to the actual call site.
        record = self._log.makeRecord(
            self._log.name, level, "(unknown)", 0, msg, (), None,
        )
        # Override caller info from the frame two levels up
        import sys as _sys
        frame = _sys._getframe(2)
        record.pathname = frame.f_code.co_filename
        record.lineno = frame.f_lineno
        record.funcName = frame.f_code.co_name
        record.module = frame.f_globals.get("__name__", "")

        record.extra_data = extra or {}  # type: ignore[attr-defined]
        self._log.handle(record)

    def debug(self, msg: str, extra: dict | None = None) -> None:
        self._log_with_extra(logging.DEBUG, msg, extra)

    def info(self, msg: str, extra: dict | None = None) -> None:
        self._log_with_extra(logging.INFO, msg, extra)

    def warning(self, msg: str, extra: dict | None = None) -> None:
        self._log_with_extra(logging.WARNING, msg, extra)

    # Backward-compatible alias — prefer ``warning()`` for consistency
    # with the Python standard library.
    warn = warning

    def error(self, msg: str, extra: dict | None = None) -> None:
        self._log_with_extra(logging.ERROR, msg, extra)


log = LoggerAdapter(_setup_logger())
