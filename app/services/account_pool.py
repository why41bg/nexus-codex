"""Account pool manager - handles account acquisition and release with queuing."""

from __future__ import annotations

import asyncio
import time
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from app.config import settings
from app.models import Account
from app.services.token_manager import TokenManager
from app.services.chatgpt_client import ChatGPTClient
from app.utils.logger import log


@dataclass
class PoolEntry:
    """A single entry in the account pool."""

    account_id: str
    codex_home: str

    # ChatGPT client (Plus quota path)
    token_manager: TokenManager | None = None
    chatgpt_client: ChatGPTClient | None = None

    active_count: int = 0
    max_concurrency: int = 1
    healthy: bool = True


class AccountPool:
    """
    Manages a pool of ChatGPT Plus accounts with concurrency control.

    Each account uses the ChatGPT Plus API endpoint (not OpenAI API).
    Scheduling strategy: least-loaded first, round-robin tie-breaker.
    """

    def __init__(self) -> None:
        self._pool: list[PoolEntry] = []
        self._counter: int = 0
        self._wait_queue: asyncio.Queue[asyncio.Future[PoolEntry | None]] = (
            asyncio.Queue()
        )
        self._event_handlers: list[Callable[[dict[str, Any]], None]] = []
        # Session affinity: session_id -> account_id (LRU ordered dict)
        self._session_bindings: OrderedDict[str, str] = OrderedDict()
        # Track which sessions are bound to each account
        self._account_sessions: dict[str, set[str]] = {}
        # Session binding max size to prevent memory growth
        self._max_session_bindings: int = 10000

    async def init_async(self, accounts: list[Account]) -> None:
        """Initialize the pool with accounts."""
        self._pool = []
        for acc in accounts:
            if not acc.enabled:
                continue
            token_mgr = TokenManager(acc.codex_home)
            chatgpt = ChatGPTClient(token_mgr)
            self._pool.append(
                PoolEntry(
                    account_id=acc.id,
                    codex_home=acc.codex_home,
                    token_manager=token_mgr,
                    chatgpt_client=chatgpt,
                    active_count=0,
                    max_concurrency=acc.max_concurrency or settings.default_max_concurrency,
                    healthy=acc.healthy,
                )
            )
        log.info(
            "Account pool initialized",
            extra={
                "count": len(self._pool),
                "default_max_concurrency": settings.default_max_concurrency,
            },
        )

    def bind_session(self, session_id: str, account_id: str) -> None:
        """Bind a session to a specific account for session affinity.
        
        Uses LRU semantics: moving an existing binding to end of OrderedDict.
        Automatically evicts oldest binding when max size is reached.
        """
        # Unbind from previous account if any
        if session_id in self._session_bindings:
            prev_account = self._session_bindings[session_id]
            if prev_account in self._account_sessions:
                self._account_sessions[prev_account].discard(session_id)
        
        # Evict oldest if at max capacity
        while len(self._session_bindings) >= self._max_session_bindings:
            oldest_session_id, oldest_account_id = self._session_bindings.popitem(last=False)
            if oldest_account_id in self._account_sessions:
                self._account_sessions[oldest_account_id].discard(oldest_session_id)
        
        self._session_bindings[session_id] = account_id
        if account_id not in self._account_sessions:
            self._account_sessions[account_id] = set()
        self._account_sessions[account_id].add(session_id)

    def unbind_session(self, session_id: str) -> None:
        """Unbind a session from its account."""
        if session_id in self._session_bindings:
            account_id = self._session_bindings[session_id]
            if account_id in self._account_sessions:
                self._account_sessions[account_id].discard(session_id)
            del self._session_bindings[session_id]

    def touch_session(self, session_id: str) -> None:
        """Move session to end of OrderedDict for LRU tracking."""
        if session_id in self._session_bindings:
            self._session_bindings.move_to_end(session_id)

    def get_session_account(self, session_id: str) -> str | None:
        """Get the account bound to a session, or None if not bound."""
        return self._session_bindings.get(session_id)

    def acquire(self, session_id: str | None = None) -> PoolEntry | None:
        """
        Synchronously acquire an available healthy account.

        If session_id is provided and has a bound account that is still available
        and has capacity, prefer that account (session affinity).
        
        Otherwise, select the least-loaded available account (round-robin tie-breaker).
        
        Returns None if no slots available.
        """
        # Try session affinity first: if session has a bound account with capacity, use it
        if session_id:
            bound_account_id = self._session_bindings.get(session_id)
            if bound_account_id:
                bound_entry = self._find_entry(bound_account_id)
                if (bound_entry and bound_entry.healthy and 
                    bound_entry.active_count < bound_entry.max_concurrency):
                    bound_entry.active_count += 1
                    self._emit_event({"type": "pool_changed"})
                    return bound_entry

        # Fall back to least-loaded selection
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

    async def acquire_async(self, timeout_ms: int | None = None, session_id: str | None = None) -> PoolEntry | None:
        """Acquire with async queuing and timeout."""
        entry = self.acquire(session_id)
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
            entry = self.acquire()  # Queue entries don't have session_id, use default
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
                "token_info": e.token_manager.get_account_info() if e.token_manager else {},
            }
            for e in self._pool
        ]

    def add_entry(self, account: Account) -> None:
        """Add an account to the pool at runtime."""
        if any(e.account_id == account.id for e in self._pool):
            return
        token_mgr = TokenManager(account.codex_home)
        chatgpt = ChatGPTClient(token_mgr)
        self._pool.append(
            PoolEntry(
                account_id=account.id,
                codex_home=account.codex_home,
                token_manager=token_mgr,
                chatgpt_client=chatgpt,
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
        # Clean up session bindings for this account
        if account_id in self._account_sessions:
            for session_id in list(self._account_sessions[account_id]):
                if session_id in self._session_bindings:
                    del self._session_bindings[session_id]
            del self._account_sessions[account_id]
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

    async def close(self) -> None:
        """Clean up resources."""
        pass
