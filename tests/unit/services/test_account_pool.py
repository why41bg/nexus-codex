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


async def _make_pool_with_accounts(*accounts: Account):
    """Create an initialized AccountPool with the given accounts."""
    from app.services.account_pool import AccountPool

    with (
        patch("app.services.account_pool.TokenManager") as mock_tm,
        patch("app.services.account_pool.ChatGPTClient") as mock_cc,
    ):
        mock_tm.return_value = MagicMock()
        mock_cc.return_value = MagicMock()
        pool = AccountPool()
        await pool.init_async(list(accounts))
        return pool


# ═══════════════════════════════════════════════════════════════
# init_async
# ═══════════════════════════════════════════════════════════════


class TestInit:
    """Tests for AccountPool.init_async()."""

    @pytest.mark.asyncio
    async def test_init_with_enabled_accounts(self):
        pool = await _make_pool_with_accounts(
            _make_account("acc-1", enabled=True),
            _make_account("acc-2", enabled=False),
            _make_account("acc-3", enabled=True),
        )
        assert len(pool.entries()) == 2
        ids = {e.account_id for e in pool.entries()}
        assert ids == {"acc-1", "acc-3"}

    @pytest.mark.asyncio
    async def test_init_respects_max_concurrency(self):
        pool = await _make_pool_with_accounts(
            _make_account("acc-1", max_concurrency=5),
        )
        entry = pool.entries()[0]
        assert entry.max_concurrency == 5

    @pytest.mark.asyncio
    async def test_init_empty_accounts(self):
        pool = await _make_pool_with_accounts()
        assert len(pool.entries()) == 0


# ═══════════════════════════════════════════════════════════════
# acquire / release
# ═══════════════════════════════════════════════════════════════


class TestAcquireRelease:
    """Tests for acquire() and release()."""

    @pytest.mark.asyncio
    async def test_acquire_returns_entry(self):
        pool = await _make_pool_with_accounts(_make_account("acc-1"))
        entry = pool.acquire()
        assert entry is not None
        assert entry.account_id == "acc-1"
        assert entry.active_count == 1

    @pytest.mark.asyncio
    async def test_acquire_unhealthy_skipped(self):
        pool = await _make_pool_with_accounts(
            _make_account("acc-1", healthy=False),
            _make_account("acc-2", healthy=True),
        )
        entry = pool.acquire()
        assert entry is not None
        assert entry.account_id == "acc-2"

    @pytest.mark.asyncio
    async def test_acquire_at_max_concurrency_returns_none(self):
        pool = await _make_pool_with_accounts(
            _make_account("acc-1", max_concurrency=1),
        )
        entry1 = pool.acquire()
        assert entry1 is not None
        entry2 = pool.acquire()
        assert entry2 is None

    @pytest.mark.asyncio
    async def test_release_frees_slot(self):
        pool = await _make_pool_with_accounts(
            _make_account("acc-1", max_concurrency=1),
        )
        entry = pool.acquire()
        assert entry.active_count == 1

        pool.release("acc-1")
        assert entry.active_count == 0

        entry2 = pool.acquire()
        assert entry2 is not None

    @pytest.mark.asyncio
    async def test_release_unknown_account_noop(self):
        pool = await _make_pool_with_accounts(_make_account("acc-1"))
        pool.release("nonexistent")  # should not raise

    @pytest.mark.asyncio
    async def test_least_loaded_first(self):
        pool = await _make_pool_with_accounts(
            _make_account("acc-1", max_concurrency=5),
            _make_account("acc-2", max_concurrency=5),
        )
        pool.acquire()  # acc-1 active_count=1
        entry = pool.acquire()
        assert entry.account_id == "acc-2"

    @pytest.mark.asyncio
    async def test_round_robin_tie_breaker(self):
        pool = await _make_pool_with_accounts(
            _make_account("acc-1", max_concurrency=5),
            _make_account("acc-2", max_concurrency=5),
        )
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
        pool = await _make_pool_with_accounts(_make_account("acc-1"))
        entry = await pool.acquire_async()
        assert entry is not None
        assert entry.account_id == "acc-1"

    @pytest.mark.asyncio
    async def test_acquire_async_timeout(self):
        pool = await _make_pool_with_accounts(
            _make_account("acc-1", max_concurrency=1),
        )
        pool.acquire()  # take the only slot
        entry = await pool.acquire_async(timeout_ms=50)
        assert entry is None

    @pytest.mark.asyncio
    async def test_acquire_async_queued_then_released(self):
        pool = await _make_pool_with_accounts(
            _make_account("acc-1", max_concurrency=1),
        )
        pool.acquire()  # take the only slot

        async def delayed_acquire():
            return await pool.acquire_async(timeout_ms=5000)

        task = asyncio.create_task(delayed_acquire())
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
        pool = await _make_pool_with_accounts(_make_account("acc-1"))
        assert len(pool.entries()) == 1

        pool.add_entry(_make_account("acc-2"))
        assert len(pool.entries()) == 2

    @pytest.mark.asyncio
    async def test_add_duplicate_entry_noop(self):
        pool = await _make_pool_with_accounts(_make_account("acc-1"))
        pool.add_entry(_make_account("acc-1"))
        assert len(pool.entries()) == 1

    @pytest.mark.asyncio
    async def test_update_entry_healthy(self):
        pool = await _make_pool_with_accounts(_make_account("acc-1"))
        pool.update_entry("acc-1", healthy=False)
        entry = pool.entries()[0]
        assert entry.healthy is False

    @pytest.mark.asyncio
    async def test_update_entry_max_concurrency(self):
        pool = await _make_pool_with_accounts(_make_account("acc-1"))
        pool.update_entry("acc-1", max_concurrency=10)
        entry = pool.entries()[0]
        assert entry.max_concurrency == 10

    @pytest.mark.asyncio
    async def test_update_unknown_entry_noop(self):
        pool = await _make_pool_with_accounts(_make_account("acc-1"))
        pool.update_entry("nonexistent", healthy=False)  # should not raise

    @pytest.mark.asyncio
    async def test_remove_entry(self):
        pool = await _make_pool_with_accounts(
            _make_account("acc-1"), _make_account("acc-2"),
        )
        pool.remove_entry("acc-1")
        assert len(pool.entries()) == 1
        assert pool.entries()[0].account_id == "acc-2"

    @pytest.mark.asyncio
    async def test_remove_unknown_entry(self):
        pool = await _make_pool_with_accounts(_make_account("acc-1"))
        pool.remove_entry("nonexistent")  # should not raise
        assert len(pool.entries()) == 1


# ═══════════════════════════════════════════════════════════════
# get_status
# ═══════════════════════════════════════════════════════════════


class TestGetStatus:
    """Tests for get_status()."""

    @pytest.mark.asyncio
    async def test_get_status_returns_list(self):
        pool = await _make_pool_with_accounts(_make_account("acc-1"))
        status = pool.get_status()
        assert len(status) == 1
        assert status[0]["account_id"] == "acc-1"
        assert "active_count" in status[0]
        assert "max_concurrency" in status[0]
        assert "healthy" in status[0]

    @pytest.mark.asyncio
    async def test_get_status_empty_pool(self):
        pool = await _make_pool_with_accounts()
        assert pool.get_status() == []


# ═══════════════════════════════════════════════════════════════
# Event handlers
# ═══════════════════════════════════════════════════════════════


class TestEvents:
    """Tests for event handler registration and emission."""

    @pytest.mark.asyncio
    async def test_event_fired_on_acquire(self):
        pool = await _make_pool_with_accounts(_make_account("acc-1"))
        events = []
        pool.on_event(lambda e: events.append(e))
        pool.acquire()
        assert len(events) == 1
        assert events[0]["type"] == "pool_changed"

    @pytest.mark.asyncio
    async def test_event_fired_on_release(self):
        pool = await _make_pool_with_accounts(_make_account("acc-1"))
        pool.acquire()
        events = []
        pool.on_event(lambda e: events.append(e))
        pool.release("acc-1")
        assert len(events) == 1
        assert events[0]["type"] == "pool_changed"

    @pytest.mark.asyncio
    async def test_event_handler_exception_suppressed(self):
        pool = await _make_pool_with_accounts(_make_account("acc-1"))

        def bad_handler(event):
            raise RuntimeError("boom")

        pool.on_event(bad_handler)
        pool.acquire()  # should not raise