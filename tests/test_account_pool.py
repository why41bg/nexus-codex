"""Unit tests for AccountPool — account acquisition, release, and concurrency control."""

from __future__ import annotations

import asyncio
from unittest.mock import MagicMock, patch

import pytest

from app.models import Account


# ═══════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════


def _make_account(account_id: str, **kwargs) -> Account:
    defaults = {
        "id": account_id,
        "codex_home": f"/tmp/{account_id}",
        "enabled": True,
        "healthy": True,
    }
    defaults.update(kwargs)
    return Account(**defaults)


def _make_pool():
    """Create an AccountPool with TokenManager/ChatGPTClient mocked."""
    from app.services.account_pool import AccountPool

    with (
        patch("app.services.account_pool.TokenManager") as mock_tm,
        patch("app.services.account_pool.ChatGPTClient") as mock_cc,
    ):
        mock_tm.return_value = MagicMock()
        mock_cc.return_value = MagicMock()
        pool = AccountPool()
        return pool


# ═══════════════════════════════════════════════════════════════
# init_async
# ═══════════════════════════════════════════════════════════════


class TestInit:
    """Tests for AccountPool.init_async()."""

    @pytest.mark.asyncio
    async def test_init_with_enabled_accounts(self):
        """Only enabled accounts should be added to the pool."""
        pool = _make_pool()
        accounts = [
            _make_account("acc-1", enabled=True),
            _make_account("acc-2", enabled=False),
            _make_account("acc-3", enabled=True),
        ]
        await pool.init_async(accounts)
        assert len(pool.entries()) == 2
        ids = {e.account_id for e in pool.entries()}
        assert ids == {"acc-1", "acc-3"}

    @pytest.mark.asyncio
    async def test_init_respects_max_concurrency(self):
        """Custom max_concurrency should override default."""
        pool = _make_pool()
        accounts = [_make_account("acc-1", max_concurrency=5)]
        await pool.init_async(accounts)
        entry = pool.entries()[0]
        assert entry.max_concurrency == 5

    @pytest.mark.asyncio
    async def test_init_empty_accounts(self):
        """Empty account list should result in empty pool."""
        pool = _make_pool()
        await pool.init_async([])
        assert len(pool.entries()) == 0


# ═══════════════════════════════════════════════════════════════
# acquire / release
# ═══════════════════════════════════════════════════════════════


class TestAcquireRelease:
    """Tests for acquire() and release()."""

    @pytest.mark.asyncio
    async def test_acquire_returns_entry(self):
        """acquire() should return a healthy entry with available slots."""
        pool = _make_pool()
        await pool.init_async([_make_account("acc-1")])

        entry = pool.acquire()
        assert entry is not None
        assert entry.account_id == "acc-1"
        assert entry.active_count == 1

    @pytest.mark.asyncio
    async def test_acquire_unhealthy_skipped(self):
        """Unhealthy accounts should not be acquired."""
        pool = _make_pool()
        await pool.init_async([
            _make_account("acc-1", healthy=False),
            _make_account("acc-2", healthy=True),
        ])

        entry = pool.acquire()
        assert entry is not None
        assert entry.account_id == "acc-2"

    @pytest.mark.asyncio
    async def test_acquire_at_max_concurrency_returns_none(self):
        """When all slots are used, acquire() returns None."""
        pool = _make_pool()
        await pool.init_async([_make_account("acc-1", max_concurrency=1)])

        entry1 = pool.acquire()
        assert entry1 is not None
        entry2 = pool.acquire()
        assert entry2 is None

    @pytest.mark.asyncio
    async def test_release_frees_slot(self):
        """release() should decrement active_count and allow re-acquire."""
        pool = _make_pool()
        await pool.init_async([_make_account("acc-1", max_concurrency=1)])

        entry = pool.acquire()
        assert entry.active_count == 1

        pool.release("acc-1")
        assert entry.active_count == 0

        entry2 = pool.acquire()
        assert entry2 is not None

    @pytest.mark.asyncio
    async def test_release_unknown_account_noop(self):
        """release() on unknown account should not raise."""
        pool = _make_pool()
        await pool.init_async([_make_account("acc-1")])
        pool.release("nonexistent")  # should not raise

    @pytest.mark.asyncio
    async def test_least_loaded_first(self):
        """Least-loaded account should be selected first."""
        pool = _make_pool()
        await pool.init_async([
            _make_account("acc-1", max_concurrency=5),
            _make_account("acc-2", max_concurrency=5),
        ])

        # Acquire acc-1 once
        pool.acquire()  # acc-1 active_count=1
        # Next acquire should prefer acc-2 (load 0 vs 1)
        entry = pool.acquire()
        assert entry.account_id == "acc-2"

    @pytest.mark.asyncio
    async def test_round_robin_tie_breaker(self):
        """Equal-load accounts should use round-robin."""
        pool = _make_pool()
        await pool.init_async([
            _make_account("acc-1", max_concurrency=5),
            _make_account("acc-2", max_concurrency=5),
        ])

        first = pool.acquire()
        second = pool.acquire()
        assert first.account_id != second.account_id


# ═══════════════════════════════════════════════════════════════
# acquire_async (queuing)
# ═══════════════════════════════════════════════════════════════


class TestAcquireAsync:
    """Tests for acquire_async() with queuing."""

    @pytest.mark.asyncio
    async def test_acquire_async_immediate(self):
        """When slots available, acquire_async returns immediately."""
        pool = _make_pool()
        await pool.init_async([_make_account("acc-1")])

        entry = await pool.acquire_async()
        assert entry is not None
        assert entry.account_id == "acc-1"

    @pytest.mark.asyncio
    async def test_acquire_async_timeout(self):
        """When no slots, acquire_async should timeout and return None."""
        pool = _make_pool()
        await pool.init_async([_make_account("acc-1", max_concurrency=1)])

        pool.acquire()  # take the only slot
        entry = await pool.acquire_async(timeout_ms=50)
        assert entry is None

    @pytest.mark.asyncio
    async def test_acquire_async_queued_then_released(self):
        """A queued request should be fulfilled when a slot is released."""
        pool = _make_pool()
        await pool.init_async([_make_account("acc-1", max_concurrency=1)])

        pool.acquire()  # take the only slot

        # Start a queued acquire in background
        async def delayed_acquire():
            return await pool.acquire_async(timeout_ms=5000)

        task = asyncio.create_task(delayed_acquire())

        # Release after a short delay
        await asyncio.sleep(0.01)
        pool.release("acc-1")

        entry = await task
        assert entry is not None
        assert entry.account_id == "acc-1"


# ═══════════════════════════════════════════════════════════════
# CRUD operations
# ═══════════════════════════════════════════════════════════════


class TestCRUD:
    """Tests for add_entry, update_entry, remove_entry."""

    @pytest.mark.asyncio
    async def test_add_entry(self):
        """add_entry should add a new account to the pool."""
        pool = _make_pool()
        await pool.init_async([_make_account("acc-1")])
        assert len(pool.entries()) == 1

        pool.add_entry(_make_account("acc-2"))
        assert len(pool.entries()) == 2

    @pytest.mark.asyncio
    async def test_add_duplicate_entry_noop(self):
        """Adding a duplicate account should be a no-op."""
        pool = _make_pool()
        await pool.init_async([_make_account("acc-1")])

        pool.add_entry(_make_account("acc-1"))
        assert len(pool.entries()) == 1

    @pytest.mark.asyncio
    async def test_update_entry_healthy(self):
        """update_entry should change healthy status."""
        pool = _make_pool()
        await pool.init_async([_make_account("acc-1")])

        pool.update_entry("acc-1", healthy=False)
        entry = pool.entries()[0]
        assert entry.healthy is False

    @pytest.mark.asyncio
    async def test_update_entry_max_concurrency(self):
        """update_entry should change max_concurrency."""
        pool = _make_pool()
        await pool.init_async([_make_account("acc-1")])

        pool.update_entry("acc-1", max_concurrency=10)
        entry = pool.entries()[0]
        assert entry.max_concurrency == 10

    @pytest.mark.asyncio
    async def test_update_unknown_entry_noop(self):
        """update_entry on unknown account should not raise."""
        pool = _make_pool()
        await pool.init_async([_make_account("acc-1")])
        pool.update_entry("nonexistent", healthy=False)  # should not raise

    @pytest.mark.asyncio
    async def test_remove_entry(self):
        """remove_entry should remove an account from the pool."""
        pool = _make_pool()
        await pool.init_async([_make_account("acc-1"), _make_account("acc-2")])

        pool.remove_entry("acc-1")
        assert len(pool.entries()) == 1
        assert pool.entries()[0].account_id == "acc-2"

    @pytest.mark.asyncio
    async def test_remove_unknown_entry(self):
        """remove_entry on unknown account should not raise."""
        pool = _make_pool()
        await pool.init_async([_make_account("acc-1")])
        pool.remove_entry("nonexistent")  # should not raise
        assert len(pool.entries()) == 1


# ═══════════════════════════════════════════════════════════════
# get_status
# ═══════════════════════════════════════════════════════════════


class TestGetStatus:
    """Tests for get_status()."""

    @pytest.mark.asyncio
    async def test_get_status_returns_list(self):
        """get_status should return a list of status dicts."""
        pool = _make_pool()
        await pool.init_async([_make_account("acc-1")])

        status = pool.get_status()
        assert len(status) == 1
        assert status[0]["account_id"] == "acc-1"
        assert "active_count" in status[0]
        assert "max_concurrency" in status[0]
        assert "healthy" in status[0]

    @pytest.mark.asyncio
    async def test_get_status_empty_pool(self):
        """get_status on empty pool returns empty list."""
        pool = _make_pool()
        await pool.init_async([])
        assert pool.get_status() == []


# ═══════════════════════════════════════════════════════════════
# Event handlers
# ═══════════════════════════════════════════════════════════════


class TestEvents:
    """Tests for event handler registration and emission."""

    @pytest.mark.asyncio
    async def test_event_fired_on_acquire(self):
        """acquire() should emit a pool_changed event."""
        pool = _make_pool()
        await pool.init_async([_make_account("acc-1")])

        events = []
        pool.on_event(lambda e: events.append(e))

        pool.acquire()
        assert len(events) == 1
        assert events[0]["type"] == "pool_changed"

    @pytest.mark.asyncio
    async def test_event_fired_on_release(self):
        """release() should emit a pool_changed event."""
        pool = _make_pool()
        await pool.init_async([_make_account("acc-1")])

        pool.acquire()
        events = []
        pool.on_event(lambda e: events.append(e))

        pool.release("acc-1")
        assert len(events) == 1
        assert events[0]["type"] == "pool_changed"

    @pytest.mark.asyncio
    async def test_event_handler_exception_suppressed(self):
        """Exceptions in event handlers should be suppressed."""
        pool = _make_pool()
        await pool.init_async([_make_account("acc-1")])

        def bad_handler(event):
            raise RuntimeError("boom")

        pool.on_event(bad_handler)
        # Should not raise
        pool.acquire()
