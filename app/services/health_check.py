from __future__ import annotations

"""Health check service - JWT local probe + remote status check."""

import asyncio
import base64
import json
from pathlib import Path

from app.config import settings
from app.services.account_pool import pool, PoolEntry
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


def probe_local(codex_home: str, expiry_buffer_sec: int) -> bool:
    """
    Read CODEX_HOME/auth.json and check JWT expiry.
    Pure local I/O, no network.
    """
    try:
        auth_path = Path(codex_home) / "auth.json"
        if not auth_path.exists():
            return False
        raw = auth_path.read_text(encoding="utf-8")
        auth = json.loads(raw)
        access_token = auth.get("tokens", {}).get("access_token")
        if not access_token:
            return False

        # Parse JWT payload (no signature verification - just expiry check)
        parts = access_token.split(".")
        if len(parts) != 3:
            return False

        # Add padding
        payload_b64 = parts[1]
        padding = 4 - len(payload_b64) % 4
        if padding != 4:
            payload_b64 += "=" * padding

        payload = json.loads(base64.urlsafe_b64decode(payload_b64))
        exp = payload.get("exp", 0)
        import time

        expires_in = exp - time.time()
        return expires_in > expiry_buffer_sec
    except Exception:
        return False


async def trigger_probe(account_id: str) -> None:
    """Trigger an immediate local probe for a specific account."""
    entry = next((e for e in pool.entries() if e.account_id == account_id), None)
    if not entry:
        return
    healthy = probe_local(entry.codex_home, settings.health_token_expiry_buffer_sec)
    await _handle_probe_result(account_id, healthy, settings.health_fail_threshold, "local")


async def _local_check_loop() -> None:
    """High-frequency local JWT check."""
    while _running:
        for entry in pool.entries():
            try:
                healthy = probe_local(entry.codex_home, settings.health_token_expiry_buffer_sec)
                await _handle_probe_result(
                    entry.account_id, healthy, settings.health_fail_threshold, "local"
                )
            except Exception as e:
                log.warn("Local probe error", extra={"account_id": entry.account_id, "error": str(e)})
        await asyncio.sleep(settings.health_local_interval_ms / 1000.0)


async def _remote_check_loop() -> None:
    """Low-frequency remote login status check (placeholder)."""
    while _running:
        await asyncio.sleep(settings.health_remote_interval_ms / 1000.0)
        # Remote probe would call codex login status - skipped in Python version
        # as it requires spawning the codex binary


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
