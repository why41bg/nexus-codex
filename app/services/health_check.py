"""Health check service - JWT local probe + remote status check.

Uses TokenManager for token validation and auto-refresh.
"""

from __future__ import annotations

import asyncio

from app.config import settings
from app.services.account_pool import pool
from app.services.account_store import update_account
from app.services.admin_emitter import emit_admin_event
from app.utils.logger import log

_fail_counts: dict[str, int] = {}
_running = False
_tasks: list[asyncio.Task] = []


async def _handle_probe_result(
    account_id: str, healthy: bool, fail_threshold: int, source: str
) -> None:
    """Handle probe result: update health state if threshold reached."""
    entry = next((e for e in pool.entries() if e.account_id == account_id), None)
    was_healthy = entry.healthy if entry else True

    if healthy:
        _fail_counts[account_id] = 0
        if not was_healthy:
            pool.update_entry(account_id, healthy=True)
            await update_account(account_id, healthy=True)
            emit_admin_event({"type": "health_changed", "account_id": account_id, "healthy": True})
            log.info("Account recovered to healthy", extra={"account_id": account_id, "source": source})
    else:
        count = _fail_counts.get(account_id, 0) + 1
        _fail_counts[account_id] = count
        if count >= fail_threshold and was_healthy:
            pool.update_entry(account_id, healthy=False)
            await update_account(account_id, healthy=False)
            emit_admin_event({"type": "health_changed", "account_id": account_id, "healthy": False})
            log.warn("Account marked unhealthy", extra={"account_id": account_id, "source": source, "fail_count": count})


async def probe_local(entry) -> bool:
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

    # No valid token and not refreshable
    return False


async def trigger_probe(account_id: str) -> None:
    """Trigger an immediate probe for a specific account."""
    entry = next((e for e in pool.entries() if e.account_id == account_id), None)
    if not entry:
        return
    healthy = await probe_local(entry)
    await _handle_probe_result(account_id, healthy, settings.health_fail_threshold, "local")


async def _local_check_loop() -> None:
    """High-frequency local token check with auto-refresh."""
    while _running:
        for entry in pool.entries():
            try:
                healthy = await probe_local(entry)
                await _handle_probe_result(
                    entry.account_id, healthy, settings.health_fail_threshold, "local"
                )
            except Exception as e:
                log.warn("Local probe error", extra={"account_id": entry.account_id, "error": str(e)})
        await asyncio.sleep(settings.health_local_interval_ms / 1000.0)


async def _remote_check_loop() -> None:
    """Low-frequency remote connectivity check.

    Verifies that the ChatGPT backend is reachable with the current token.
    """
    while _running:
        await asyncio.sleep(settings.health_remote_interval_ms / 1000.0)
        for entry in pool.entries():
            try:
                client = entry.chatgpt_client
                if not client:
                    continue
                # Quick connectivity check via /me endpoint
                await client.get_account_info()
                await _handle_probe_result(
                    entry.account_id, True, settings.health_fail_threshold, "remote"
                )
            except Exception as e:
                log.warn("Remote probe error", extra={"account_id": entry.account_id, "error": str(e)})
                await _handle_probe_result(
                    entry.account_id, False, settings.health_fail_threshold, "remote"
                )


def start_health_check() -> None:
    """Start health check background tasks."""
    global _running
    _running = True
    loop = asyncio.get_event_loop()
    _tasks.append(loop.create_task(_local_check_loop()))
    _tasks.append(loop.create_task(_remote_check_loop()))
    log.info("Health check started")


def stop_health_check() -> None:
    """Stop health check background tasks."""
    global _running
    _running = False
    for task in _tasks:
        task.cancel()
    _tasks.clear()
