"""Unit tests for HealthCheck — local/remote probe loops and health state transitions."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.health_check import HealthChecker


def _make_mock_entry(account_id="acc-1", healthy=True, token_valid=True):
    entry = MagicMock()
    entry.account_id = account_id
    entry.healthy = healthy
    entry.token_manager = MagicMock()
    entry.token_manager.get_access_token = AsyncMock(
        return_value="valid-token" if token_valid else None
    )
    entry.chatgpt_client = MagicMock()
    entry.chatgpt_client.get_account_info = AsyncMock()
    return entry


def _make_mock_pool(entries=None):
    pool = MagicMock()
    pool.entries.return_value = entries or []
    pool.update_entry = MagicMock()
    return pool


def _make_mock_account_store():
    store = MagicMock()
    store.update_account = AsyncMock()
    return store


class TestProbeLocal:
    @pytest.mark.asyncio
    async def test_valid_token_returns_true(self):
        pool = _make_mock_pool()
        checker = HealthChecker(pool)
        entry = _make_mock_entry(token_valid=True)
        assert await checker._probe_local(entry) is True

    @pytest.mark.asyncio
    async def test_invalid_token_returns_false(self):
        pool = _make_mock_pool()
        checker = HealthChecker(pool)
        entry = _make_mock_entry(token_valid=False)
        assert await checker._probe_local(entry) is False

    @pytest.mark.asyncio
    async def test_no_token_manager_returns_false(self):
        pool = _make_mock_pool()
        checker = HealthChecker(pool)
        entry = MagicMock()
        entry.token_manager = None
        assert await checker._probe_local(entry) is False


class TestHandleProbeResult:
    @pytest.mark.asyncio
    async def test_healthy_no_change(self):
        entry = _make_mock_entry(healthy=True)
        pool = _make_mock_pool([entry])
        account_store = _make_mock_account_store()
        checker = HealthChecker(pool, account_store=account_store)

        await checker._handle_probe_result("acc-1", True, 3, "local")
        account_store.update_account.assert_not_called()

    @pytest.mark.asyncio
    async def test_unhealthy_below_threshold(self):
        entry = _make_mock_entry(healthy=True)
        pool = _make_mock_pool([entry])
        account_store = _make_mock_account_store()
        checker = HealthChecker(pool, account_store=account_store)

        await checker._handle_probe_result("acc-1", False, 3, "local")
        account_store.update_account.assert_not_called()

    @pytest.mark.asyncio
    async def test_unhealthy_threshold_reached(self):
        entry = _make_mock_entry(healthy=True)
        pool = _make_mock_pool([entry])
        mock_emitter = MagicMock()
        account_store = _make_mock_account_store()
        checker = HealthChecker(pool, admin_emitter=mock_emitter, account_store=account_store)

        for _ in range(3):
            await checker._handle_probe_result("acc-1", False, 3, "local")
        account_store.update_account.assert_called_once_with("acc-1", healthy=False)
        pool.update_entry.assert_called_with("acc-1", healthy=False)
        mock_emitter.emit.assert_called_with({"type": "health_changed", "account_id": "acc-1", "healthy": False})

    @pytest.mark.asyncio
    async def test_recovery_after_unhealthy(self):
        entry = _make_mock_entry(healthy=False)
        pool = _make_mock_pool([entry])
        mock_emitter = MagicMock()
        account_store = _make_mock_account_store()
        checker = HealthChecker(pool, admin_emitter=mock_emitter, account_store=account_store)

        await checker._handle_probe_result("acc-1", True, 3, "local")
        account_store.update_account.assert_called_once_with("acc-1", healthy=True)
        pool.update_entry.assert_called_with("acc-1", healthy=True)
        mock_emitter.emit.assert_called_with({"type": "health_changed", "account_id": "acc-1", "healthy": True})


class TestTriggerProbe:
    @pytest.mark.asyncio
    async def test_triggers_probe_for_existing_account(self):
        entry = _make_mock_entry(healthy=True, token_valid=True)
        pool = _make_mock_pool([entry])
        checker = HealthChecker(pool)

        with patch.object(checker, "_handle_probe_result", new_callable=AsyncMock) as mock_handle:
            await checker.trigger_probe("acc-1")
            mock_handle.assert_called_once()

    @pytest.mark.asyncio
    async def test_unknown_account_noop(self):
        pool = _make_mock_pool([])
        checker = HealthChecker(pool)

        with patch.object(checker, "_probe_local", new_callable=AsyncMock) as mock_probe:
            await checker.trigger_probe("nonexistent")
            mock_probe.assert_not_called()
