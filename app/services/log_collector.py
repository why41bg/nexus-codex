"""Structured log collector — declarative event recording layer.

Events are defined as data in the EVENTS registry. The single `emit()` method
resolves metadata (level, source, tags) from the registry and writes to
LogStore. For ad-hoc or unregistered events, `emit()` accepts optional
overrides so callers are never blocked.

Usage:
    collector.emit("upstream_error", "HTTP 429 for gpt-4",
                   account_id="acct_123", context={...})
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.services.log_store import LogStore


# ─── Event Definition ────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class EventDef:
    """Declarative definition of a structured event type."""

    name: str
    level: str
    source: str
    tags: list[str] = field(default_factory=list)


# ─── Event Registry (single source of truth) ─────────────────────

EVENTS: dict[str, EventDef] = {e.name: e for e in [
    # Request lifecycle
    EventDef("request_complete",       "warn",  "middleware.access",     ["category:request"]),
    EventDef("request_error",          "error", "middleware.access",     ["category:request", "severity:actionable"]),

    # Authentication
    EventDef("auth_failure",           "warn",  "middleware.auth",       ["category:auth"]),
    EventDef("login_success",          "info",  "route.admin",           ["category:auth"]),
    EventDef("login_failure",          "warn",  "route.admin",           ["category:auth"]),
    EventDef("ip_auto_banned",         "warn",  "middleware.ip_ban",     ["category:auth", "severity:actionable"]),
    EventDef("ip_blocked",             "warn",  "middleware.ip_ban",     ["category:auth"]),

    # Account pool
    EventDef("account_acquired",       "debug", "service.pool",          ["category:pool"]),
    EventDef("account_released",       "debug", "service.pool",          ["category:pool"]),
    EventDef("all_accounts_exhausted", "error", "service.pool",          ["category:pool", "severity:critical"]),

    # Health check
    EventDef("health_check_fail",      "warn",  "service.health",        ["category:health"]),
    EventDef("token_expired",          "error", "service.health",        ["category:health", "severity:actionable"]),

    # Upstream API
    EventDef("upstream_error",         "error", "route.upstream",        ["category:request", "severity:actionable"]),
    EventDef("upstream_timeout",       "error", "route.upstream",        ["category:request", "severity:actionable"]),

    # Rate limiting / Quota
    EventDef("rate_limit_hit",         "warn",  "middleware.rate_limit", ["category:request"]),
    EventDef("quota_exceeded",         "warn",  "middleware.auth",       ["category:request"]),

    # System
    EventDef("service_started",        "info",  "system",               ["category:system"]),
    EventDef("service_stopped",        "info",  "system",               ["category:system"]),
    EventDef("unhandled_exception",    "error", "system",               ["category:system", "severity:critical"]),
]}


# ─── LogCollector ─────────────────────────────────────────────────


class LogCollector:
    """Collects structured application events and persists them via LogStore.

    All events flow through a single `emit()` method. Event metadata (level,
    source, tags) is resolved from the EVENTS registry; callers can override
    any field for ad-hoc events not yet registered.
    """

    _LEVEL_ORDER: dict[str, int] = {
        "debug": 0, "info": 1, "warn": 2, "error": 3, "critical": 4,
    }

    def __init__(self, log_store: LogStore, min_level: str = "info") -> None:
        self._store = log_store
        self._min_level_rank = self._LEVEL_ORDER.get(min_level, 1)

    def _should_record(self, level: str) -> bool:
        return self._LEVEL_ORDER.get(level, 1) >= self._min_level_rank

    # ─── Public API ───────────────────────────────────────────────

    async def emit(
        self,
        event: str,
        message: str,
        *,
        context: dict[str, Any] | None = None,
        trace_id: str | None = None,
        session_id: str | None = None,
        account_id: str | None = None,
        api_key_id: str | None = None,
        client_ip: str | None = None,
        duration_ms: int | None = None,
        # Overrides (used for ad-hoc / unregistered events)
        level: str | None = None,
        source: str | None = None,
        tags: list[str] | None = None,
    ) -> None:
        """Emit a structured event.

        Resolves level/source/tags from the EVENTS registry by event name.
        If the event is not registered, uses provided overrides or sensible
        defaults (level="info", source="app", tags=[]).
        """
        defn = EVENTS.get(event)
        resolved_level = level or (defn.level if defn else "info")
        resolved_source = source or (defn.source if defn else "app")
        resolved_tags = tags if tags is not None else (list(defn.tags) if defn else [])

        if not self._should_record(resolved_level):
            return

        await self._store.write(
            level=resolved_level,
            source=resolved_source,
            event=event,
            message=message,
            context=context,
            tags=resolved_tags,
            trace_id=trace_id,
            session_id=session_id,
            account_id=account_id,
            api_key_id=api_key_id,
            client_ip=client_ip,
            duration_ms=duration_ms,
        )
