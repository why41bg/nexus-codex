"""Structured log collector — semantic event recording layer.

Provides named methods for all known application events. Each method
maps business parameters into the LogStore's generic write() interface,
handling source/event/tags assignment internally.

For ad-hoc or future events not yet covered by a named method,
use the generic emit() escape hatch.
"""

from __future__ import annotations

from app.services.log_store import LogStore


class LogCollector:
    """Collects structured application events and persists them via LogStore."""

    def __init__(self, log_store: LogStore, min_level: str = "info") -> None:
        self._store = log_store
        self._level_order = {"debug": 0, "info": 1, "warn": 2, "error": 3, "critical": 4}
        self._min_level_rank = self._level_order.get(min_level, 1)

    def _should_record(self, level: str) -> bool:
        return self._level_order.get(level, 1) >= self._min_level_rank

    # ─── Request lifecycle ───────────────────────────────────────

    def on_request_complete(
        self,
        *,
        method: str,
        path: str,
        status: int,
        latency_ms: int,
        client_ip: str,
        model: str | None = None,
        trace_id: str | None = None,
        api_key_id: str | None = None,
        account_id: str | None = None,
    ) -> None:
        # Only store error/warn requests (>= 400) in LogStore.
        # Successful (2xx/3xx) requests are covered by the metrics system
        # and stdout logs; storing them would create excessive noise.
        if status < 400:
            return
        level = "error" if status >= 500 else "warn"
        if not self._should_record(level):
            return
        self._store.write(
            level=level,
            source="middleware.access",
            event="request_complete",
            message=f"{method} {path} → {status}",
            context={
                "method": method, "path": path, "status": status,
                "model": model, "account_id": account_id,
            },
            tags=["category:request"],
            trace_id=trace_id,
            api_key_id=api_key_id,
            account_id=account_id,
            client_ip=client_ip,
            duration_ms=latency_ms,
        )

    def on_request_error(
        self,
        *,
        method: str,
        path: str,
        error: str,
        client_ip: str,
        trace_id: str | None = None,
        api_key_id: str | None = None,
    ) -> None:
        if not self._should_record("error"):
            return
        self._store.write(
            level="error",
            source="middleware.access",
            event="request_error",
            message=f"{method} {path} failed: {error}",
            context={"method": method, "path": path, "error": error},
            tags=["category:request", "severity:actionable"],
            trace_id=trace_id,
            api_key_id=api_key_id,
            client_ip=client_ip,
        )

    # ─── Authentication ──────────────────────────────────────────

    def on_auth_failure(
        self,
        *,
        reason: str,
        client_ip: str,
        api_key_masked: str | None = None,
    ) -> None:
        if not self._should_record("warn"):
            return
        self._store.write(
            level="warn",
            source="middleware.auth",
            event="auth_failure",
            message=f"Auth failed: {reason}",
            context={"reason": reason},
            tags=["category:auth"],
            api_key_id=api_key_masked,
            client_ip=client_ip,
        )

    def on_login_success(
        self,
        *,
        username: str,
        client_ip: str,
        session_id: str | None = None,
    ) -> None:
        if not self._should_record("info"):
            return
        self._store.write(
            level="info",
            source="route.admin",
            event="login_success",
            message=f"Admin login: {username}",
            context={"username": username},
            tags=["category:auth"],
            session_id=session_id,
            client_ip=client_ip,
        )

    def on_login_failure(
        self,
        *,
        username: str,
        client_ip: str,
    ) -> None:
        if not self._should_record("warn"):
            return
        self._store.write(
            level="warn",
            source="route.admin",
            event="login_failure",
            message=f"Admin login failed: {username}",
            context={"username": username},
            tags=["category:auth"],
            client_ip=client_ip,
        )

    def on_ip_banned(
        self,
        *,
        ip: str,
        reason: str,
    ) -> None:
        if not self._should_record("warn"):
            return
        self._store.write(
            level="warn",
            source="middleware.ip_ban",
            event="ip_auto_banned",
            message=f"IP auto-banned: {ip}",
            context={"reason": reason},
            tags=["category:auth", "severity:actionable"],
            client_ip=ip,
        )

    # ─── Account pool ────────────────────────────────────────────

    def on_account_acquired(
        self,
        *,
        account_id: str,
        model: str,
        wait_ms: int | None = None,
        trace_id: str | None = None,
    ) -> None:
        if not self._should_record("debug"):
            return
        self._store.write(
            level="debug",
            source="service.pool",
            event="account_acquired",
            message=f"Acquired account {account_id} for {model}",
            context={"model": model, "wait_ms": wait_ms},
            tags=["category:pool"],
            trace_id=trace_id,
            account_id=account_id,
            duration_ms=wait_ms,
        )

    def on_account_exhausted(
        self,
        *,
        model: str,
        pool_size: int | None = None,
        trace_id: str | None = None,
    ) -> None:
        if not self._should_record("error"):
            return
        self._store.write(
            level="error",
            source="service.pool",
            event="all_accounts_exhausted",
            message=f"No available accounts for {model}",
            context={"model": model, "pool_size": pool_size},
            tags=["category:pool", "severity:critical"],
            trace_id=trace_id,
        )

    def on_account_released(
        self,
        *,
        account_id: str,
        model: str,
        usage_ms: int | None = None,
        trace_id: str | None = None,
    ) -> None:
        if not self._should_record("debug"):
            return
        self._store.write(
            level="debug",
            source="service.pool",
            event="account_released",
            message=f"Released account {account_id} for {model}",
            context={"model": model},
            tags=["category:pool"],
            trace_id=trace_id,
            account_id=account_id,
            duration_ms=usage_ms,
        )

    # ─── Health check ────────────────────────────────────────────

    def on_health_check_fail(
        self,
        *,
        account_id: str,
        reason: str,
        check_type: str | None = None,
        fail_count: int | None = None,
    ) -> None:
        if not self._should_record("warn"):
            return
        self._store.write(
            level="warn",
            source="service.health",
            event="health_check_fail",
            message=f"Health check failed for {account_id}: {reason}",
            context={"reason": reason, "check_type": check_type, "fail_count": fail_count},
            tags=["category:health"],
            account_id=account_id,
        )

    def on_token_expired(
        self,
        *,
        account_id: str,
    ) -> None:
        if not self._should_record("error"):
            return
        self._store.write(
            level="error",
            source="service.health",
            event="token_expired",
            message=f"Token expired for {account_id}",
            context={},
            tags=["category:health", "severity:actionable"],
            account_id=account_id,
        )

    # ─── Upstream API ────────────────────────────────────────────

    def on_upstream_error(
        self,
        *,
        account_id: str,
        model: str,
        status: int,
        error: str,
        trace_id: str | None = None,
        retry_count: int | None = None,
    ) -> None:
        if not self._should_record("error"):
            return
        self._store.write(
            level="error",
            source="route.upstream",
            event="upstream_error",
            message=f"Upstream error {status} for {model}: {error}",
            context={"model": model, "upstream_status": status, "error": error, "retry_count": retry_count},
            tags=["category:request", "severity:actionable"],
            trace_id=trace_id,
            account_id=account_id,
        )

    def on_upstream_timeout(
        self,
        *,
        account_id: str,
        model: str,
        timeout_ms: int,
        trace_id: str | None = None,
    ) -> None:
        if not self._should_record("error"):
            return
        self._store.write(
            level="error",
            source="route.upstream",
            event="upstream_timeout",
            message=f"Upstream timeout for {model} after {timeout_ms}ms",
            context={"model": model, "timeout_ms": timeout_ms},
            tags=["category:request", "severity:actionable"],
            trace_id=trace_id,
            account_id=account_id,
            duration_ms=timeout_ms,
        )

    # ─── System events ───────────────────────────────────────────

    def on_system_event(
        self,
        *,
        event: str,
        message: str,
        context: dict | None = None,
    ) -> None:
        if not self._should_record("info"):
            return
        self._store.write(
            level="info",
            source="system",
            event=event,
            message=message,
            context=context,
            tags=["category:system"],
        )

    def on_unhandled_exception(
        self,
        *,
        error: str,
        traceback_str: str,
        path: str | None = None,
        trace_id: str | None = None,
    ) -> None:
        if not self._should_record("error"):
            return
        self._store.write(
            level="error",
            source="system",
            event="unhandled_exception",
            message=f"Unhandled exception: {error}",
            context={"error": error, "traceback": traceback_str, "path": path},
            tags=["category:system", "severity:critical"],
            trace_id=trace_id,
        )

    # ─── Rate limiting ───────────────────────────────────────────

    def on_rate_limit_hit(
        self,
        *,
        client_ip: str,
        api_key_id: str | None = None,
        path: str | None = None,
    ) -> None:
        if not self._should_record("warn"):
            return
        self._store.write(
            level="warn",
            source="middleware.rate_limit",
            event="rate_limit_hit",
            message=f"Rate limit hit from {client_ip}",
            context={"path": path},
            tags=["category:request"],
            api_key_id=api_key_id,
            client_ip=client_ip,
        )

    # ─── Quota ───────────────────────────────────────────────────

    def on_quota_exceeded(
        self,
        *,
        client_ip: str,
        api_key_id: str | None = None,
    ) -> None:
        if not self._should_record("warn"):
            return
        self._store.write(
            level="warn",
            source="middleware.auth",
            event="quota_exceeded",
            message=f"Monthly quota exceeded for key {api_key_id}",
            context={},
            tags=["category:request"],
            api_key_id=api_key_id,
            client_ip=client_ip,
        )

    # ─── Generic emit (escape hatch) ─────────────────────────────

    def emit(
        self,
        *,
        level: str,
        source: str,
        event: str,
        message: str,
        context: dict | None = None,
        tags: list[str] | None = None,
        trace_id: str | None = None,
        account_id: str | None = None,
        api_key_id: str | None = None,
        client_ip: str | None = None,
        duration_ms: int | None = None,
        session_id: str | None = None,
    ) -> None:
        """Generic event emitter for events not covered by named methods."""
        if not self._should_record(level):
            return
        self._store.write(
            level=level,
            source=source,
            event=event,
            message=message,
            context=context,
            tags=tags,
            trace_id=trace_id,
            session_id=session_id,
            account_id=account_id,
            api_key_id=api_key_id,
            client_ip=client_ip,
            duration_ms=duration_ms,
        )
