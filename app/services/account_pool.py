"""Account pool manager - handles account acquisition and release with queuing."""

from __future__ import annotations

import asyncio
import json
import tomllib
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from openai import OpenAI

from app.config import settings
from app.models import Account
from app.utils.logger import log


@dataclass
class PoolEntry:
    """A single entry in the account pool."""

    account_id: str
    codex_home: str
    client: OpenAI
    active_count: int = 0
    max_concurrency: int = 1
    healthy: bool = True


class AccountPool:
    """
    Manages a pool of OpenAI accounts with concurrency control.

    Scheduling strategy: least-loaded first, round-robin tie-breaker.
    """

    def __init__(self) -> None:
        self._pool: list[PoolEntry] = []
        self._counter: int = 0
        self._wait_queue: asyncio.Queue[asyncio.Future[PoolEntry | None]] = (
            asyncio.Queue()
        )
        self._event_handlers: list[Callable[[dict[str, Any]], None]] = []

    def init(self, accounts: list[Account]) -> None:
        """Initialize the pool with accounts."""
        self._pool = [
            PoolEntry(
                account_id=acc.id,
                codex_home=acc.codex_home,
                client=self._create_client(acc.codex_home),
                active_count=0,
                max_concurrency=acc.max_concurrency or settings.default_max_concurrency,
                healthy=acc.healthy,
            )
            for acc in accounts
            if acc.enabled
        ]
        log.info(
            "Account pool initialized",
            extra={
                "count": len(self._pool),
                "default_max_concurrency": settings.default_max_concurrency,
            },
        )

    def _create_client(self, codex_home: str) -> OpenAI:
        """Create an OpenAI client configured to use a specific codex home."""
        auth_path = Path(codex_home) / "auth.json"
        config_path = Path(codex_home) / "config.toml"
        api_key = "dummy"
        base_url = None

        if auth_path.exists():
            try:
                auth_data = json.loads(auth_path.read_text())
                tokens = auth_data.get("tokens", {})
                api_key = tokens.get("access_token", "dummy")
            except Exception:
                pass

        if config_path.exists():
            try:
                config_data = tomllib.loads(config_path.read_text())
                # base_url is nested under [model_providers.<provider>]
                provider_name = config_data.get("model_provider")
                if provider_name:
                    provider_cfg = (
                        config_data.get("model_providers", {}).get(provider_name, {})
                    )
                    base_url = provider_cfg.get("base_url") or base_url
            except Exception:
                pass

        kwargs: dict[str, Any] = {"api_key": api_key}
        if base_url:
            kwargs["base_url"] = base_url

        return OpenAI(**kwargs)

    def acquire(self) -> PoolEntry | None:
        """
        Synchronously acquire an available healthy account.

        Returns None if no slots available.
        """
        available = sorted(
            [e for e in self._pool if e.healthy and e.active_count < e.max_concurrency],
            key=lambda e: e.active_count,
        )
        if not available:
            return None

        # Round-robin tie-breaker among least-loaded
        min_load = available[0].active_count
        candidates = [e for e in available if e.active_count == min_load]
        entry = candidates[self._counter % len(candidates)]
        self._counter += 1

        entry.active_count += 1
        self._emit_event({"type": "pool_changed"})
        return entry

    async def acquire_async(self, timeout_ms: int | None = None) -> PoolEntry | None:
        """Acquire with async queuing and timeout."""
        entry = self.acquire()
        if entry:
            return entry

        timeout_s = (timeout_ms or settings.acquire_timeout_ms) / 1000.0
        future: asyncio.Future[PoolEntry | None] = (
            asyncio.get_event_loop().create_future()
        )
        await self._wait_queue.put(future)

        try:
            return await asyncio.wait_for(future, timeout=timeout_s)
        except asyncio.TimeoutError:
            future.cancel()
            return None

    def release(self, account_id: str) -> None:
        """Release one concurrency slot for the given account."""
        entry = self._find_entry(account_id)
        if entry:
            entry.active_count = max(0, entry.active_count - 1)
        self._emit_event({"type": "pool_changed"})
        self._drain_queue()

    def _drain_queue(self) -> None:
        """Try to assign accounts to waiting requests."""
        while not self._wait_queue.empty():
            entry = self.acquire()
            if not entry:
                break
            try:
                future = self._wait_queue.get_nowait()
                if not future.done():
                    future.set_result(entry)
            except asyncio.QueueEmpty:
                entry.active_count -= 1
                break

    def get_status(self) -> list[dict[str, Any]]:
        """Get current pool status."""
        return [
            {
                "account_id": e.account_id,
                "active_count": e.active_count,
                "max_concurrency": e.max_concurrency,
                "healthy": e.healthy,
            }
            for e in self._pool
        ]

    def add_entry(self, account: Account) -> None:
        """Add an account to the pool at runtime."""
        if any(e.account_id == account.id for e in self._pool):
            return
        self._pool.append(
            PoolEntry(
                account_id=account.id,
                codex_home=account.codex_home,
                client=self._create_client(account.codex_home),
                active_count=0,
                max_concurrency=(
                    account.max_concurrency or settings.default_max_concurrency
                ),
                healthy=account.healthy,
            )
        )
        log.info("Account added to pool", extra={"account_id": account.id})

    def update_entry(
        self,
        account_id: str,
        healthy: bool | None = None,
        max_concurrency: int | None = None,
    ) -> None:
        """Update pool entry properties."""
        entry = self._find_entry(account_id)
        if not entry:
            return
        if healthy is not None:
            entry.healthy = healthy
        if max_concurrency is not None:
            entry.max_concurrency = max_concurrency

    def remove_entry(self, account_id: str) -> None:
        """Remove an account from the pool."""
        self._pool = [e for e in self._pool if e.account_id != account_id]
        log.info("Account removed from pool", extra={"account_id": account_id})

    def entries(self) -> list[PoolEntry]:
        """Get all pool entries."""
        return self._pool

    def _find_entry(self, account_id: str) -> PoolEntry | None:
        """Find a pool entry by account ID."""
        for e in self._pool:
            if e.account_id == account_id:
                return e
        return None

    def on_event(self, handler: Callable[[dict[str, Any]], None]) -> None:
        """Register an event handler."""
        self._event_handlers.append(handler)

    def _emit_event(self, event: dict[str, Any]) -> None:
        """Emit an event to all registered handlers."""
        for handler in self._event_handlers:
            try:
                handler(event)
            except Exception:
                pass


# Global singleton
pool = AccountPool()
