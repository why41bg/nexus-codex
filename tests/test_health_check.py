"""Unit tests for HealthCheck — local/remote probe loops and health state transitions."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest


@pytest.fixture(autouse=True)
def reset_health_check_state():
    import app.services.health_check as hc

    hc._fail_counts.clear()
    hc._running = False
    hc._tasks.clear()
    hc._pool = None
    yield
    hc._fail_counts.clear()
    hc._running = False
    hc._tasks.clear()
    hc._pool = None


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


class TestProbeLocal:
    @pytest.mark.asyncio
    async def test_valid_token_returns_true(self):
        from app.services.health_check import probe_local

        entry = _make_mock_entry(token_valid=True)
        assert await probe_local(entry) is True

    @pytest.mark.asyncio
    async def test_invalid_token_returns_false(self):
        from app.services.health_check import probe_local

        entry = _make_mock_entry(token_valid=False)
        assert await probe_local(entry) is False

    @pytest.mark.asyncio
    async def test_no_token_manager_returns_false(self):
        from app.services.health_check import probe_local

        entry = MagicMock()
        entry.token_manager = None
        assert await probe_local(entry) is False


class TestHandleProbeResult:
    @pytest.mark.asyncio
    async def test_healthy_no_change(self):
        from app.services.health_check import _handle_probe_result

        entry = _make_mock_entry(healthy=True)
        pool = _make_mock_pool([entry])

        with patch("app.services.health_check._pool", pool):
            with patch("app.services.health_check.update_account") as mock_update:
                await _handle_probe_result("acc-1", True, 3, "local")
                mock_update.assert_not_called()

    @pytest.mark.asyncio
    async def test_unhealthy_below_threshold(self):
        from app.services.health_check import _handle_probe_result

        entry = _make_mock_entry(healthy=True)
        pool = _make_mock_pool([entry])

        with patch("app.services.health_check._pool", pool):
            with patch("app.services.health_check.update_account") as mock_update:
                await _handle_probe_result("acc-1", False, 3, "local")
                mock_update.assert_not_called()

    @pytest.mark.asyncio
    async def test_unhealthy_threshold_reached(self):
        from app.services.health_check import _handle_probe_result

        entry = _make_mock_entry(healthy=True)
        pool = _make_mock_pool([entry])

        with patch("app.services.health_check._pool", pool):
            with patch("app.services.health_check.update_account") as mock_update:
                for _ in range(3):
                    await _handle_probe_result("acc-1", False, 3, "local")
                mock_update.assert_called_once_with("acc-1", healthy=False)
                pool.update_entry.assert_called_with("acc-1", healthy=False)

    @pytest.mark.asyncio
    async def test_recovery_after_unhealthy(self):
        from app.services.health_check import _handle_probe_result

        entry = _make_mock_entry(healthy=False)
        pool = _make_mock_pool([entry])

        with patch("app.services.health_check._pool", pool):
            with patch("app.services.health_check.update_account") as mock_update:
                await _handle_probe_result("acc-1", True, 3, "local")
                mock_update.assert_called_once_with("acc-1", healthy=True)
                pool.update_entry.assert_called_with("acc-1", healthy=True)


class TestTriggerProbe:
    @pytest.mark.asyncio
    async def test_triggers_probe_for_existing_account(self):
        from app.services.health_check import trigger_probe

        entry = _make_mock_entry(healthy=True)
        pool = _make_mock_pool([entry])

        with patch("app.services.health_check._pool", pool):
            with patch("app.services.health_check.probe_local") as mock_probe:
                mock_probe.return_value = True
                with patch("app.services.health_check._handle_probe_result") as mock_handle:
                    await trigger_probe("acc-1")
                    mock_probe.assert_called_once()
                    mock_handle.assert_called_once()

    @pytest.mark.asyncio
    async def test_unknown_account_noop(self):
        from app.services.health_check import trigger_probe

        pool = _make_mock_pool([])

        with patch("app.services.health_check._pool", pool):
            with patch("app.services.health_check.probe_local") as mock_probe:
                await trigger_probe("nonexistent")
                mock_probe.assert_not_called()
