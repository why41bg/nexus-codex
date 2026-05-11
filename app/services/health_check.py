"""Health check service - JWT local probe + remote status check.

Uses TokenManager for token validation and auto-refresh.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

from app.config import settings
from app.services.account_pool import AccountPool
from app.utils.logger import log

if TYPE_CHECKING:
    from app.services.account_store import AccountStore
    from app.services.admin_emitter import AdminEmitter
    from app.services.log_collector import LogCollector


class HealthChecker:
    """Encapsulated health check service — no module-level globals.

    All mutable state (fail counts, tasks, running flag) is instance-level,
    making the service testable and safe in multi-instance scenarios.
    """

    def __init__(
        self,
        pool: AccountPool,
        log_collector: "LogCollector | None" = None,
        admin_emitter: "AdminEmitter | None" = None,
        account_store: "AccountStore | None" = None,
    ) -> None:
        self._pool = pool
        self._log_collector = log_collector
        self._admin_emitter = admin_emitter
        self._account_store = account_store
        self._fail_counts: dict[str, int] = {}
        self._running = False
        self._tasks: list[asyncio.Task] = []

    # ─── Public API ─────────────────────────────────────────

    def start(self) -> None:
        """Start health check background tasks."""
        self._running = True
        loop = asyncio.get_event_loop()
        self._tasks.append(loop.create_task(self._local_check_loop()))
        self._tasks.append(loop.create_task(self._remote_check_loop()))
        log.info("Health check started")

    def stop(self) -> None:
        """Stop health check background tasks."""
        self._running = False
        for task in self._tasks:
            task.cancel()
        self._tasks.clear()

    async def trigger_probe(self, account_id: str) -> None:
        """Trigger an immediate probe for a specific account."""
        entry = next((e for e in self._pool.entries() if e.account_id == account_id), None)
        if not entry:
            return
        healthy = await self._probe_local(entry)
        await self._handle_probe_result(account_id, healthy, settings.health_fail_threshold, "local")

    # ─── Internal ───────────────────────────────────────────

    async def _probe_local(self, entry) -> bool:
        """Check token validity using TokenManager.

        Returns True if token is valid (not expired beyond buffer).
        Attempts auto-refresh if token is within refresh window.
        """
        token_mgr = entry.token_manager
        if not token_mgr:
            return False

        # Try to get a valid token (auto-refreshes if needed)
        token = await token_mgr.get_access_token()
        if token:
            return True

        # No valid token and not refreshable — log token expiry event
        if self._log_collector:
            await self._log_collector.emit(
                "token_expired", f"Token expired for {entry.account_id}",
                account_id=entry.account_id,
            )
        return False

    async def _handle_probe_result(
        self, account_id: str, healthy: bool, fail_threshold: int, source: str
    ) -> None:
        """Handle probe result: update health state if threshold reached."""
        entry = next((e for e in self._pool.entries() if e.account_id == account_id), None)
        was_healthy = entry.healthy if entry else True

        if healthy:
            self._fail_counts[account_id] = 0
            if not was_healthy:
                self._pool.update_entry(account_id, healthy=True)
                if self._account_store:
                    await self._account_store.update_account(account_id, healthy=True)
                if self._admin_emitter:
                    self._admin_emitter.emit({"type": "health_changed", "account_id": account_id, "healthy": True})
                log.info("Account recovered to healthy", extra={"account_id": account_id, "source": source})
        else:
            count = self._fail_counts.get(account_id, 0) + 1
            self._fail_counts[account_id] = count
            if self._log_collector:
                await self._log_collector.emit(
                    "health_check_fail",
                    f"Health check failed for {account_id}: Probe failed ({source})",
                    context={"reason": f"Probe failed ({source})", "check_type": source, "fail_count": count},
                    account_id=account_id,
                )
            if count >= fail_threshold and was_healthy:
                self._pool.update_entry(account_id, healthy=False)
                if self._account_store:
                    await self._account_store.update_account(account_id, healthy=False)
                if self._admin_emitter:
                    self._admin_emitter.emit({"type": "health_changed", "account_id": account_id, "healthy": False})
                log.warn("Account marked unhealthy", extra={"account_id": account_id, "source": source, "fail_count": count})

    async def _local_check_loop(self) -> None:
        """High-frequency local token check with auto-refresh."""
        while self._running:
            for entry in self._pool.entries():
                try:
                    healthy = await self._probe_local(entry)
                    await self._handle_probe_result(
                        entry.account_id, healthy, settings.health_fail_threshold, "local"
                    )
                except Exception as e:
                    log.warn("Local probe error", extra={"account_id": entry.account_id, "error": str(e)})
            await asyncio.sleep(settings.health_local_interval_ms / 1000.0)

    async def _remote_check_loop(self) -> None:
        """Low-frequency remote connectivity check.

        Verifies that the ChatGPT backend is reachable with the current token.
        """
        while self._running:
            await asyncio.sleep(settings.health_remote_interval_ms / 1000.0)
            for entry in self._pool.entries():
                try:
                    client = entry.chatgpt_client
                    if not client:
                        continue
                    # Quick connectivity check via /me endpoint
                    await client.get_account_info()
                    await self._handle_probe_result(
                        entry.account_id, True, settings.health_fail_threshold, "remote"
                    )
                except Exception as e:
                    log.warn("Remote probe error", extra={"account_id": entry.account_id, "error": str(e)})
                    await self._handle_probe_result(
                        entry.account_id, False, settings.health_fail_threshold, "remote"
                    )


