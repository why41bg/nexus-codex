"""Unit tests for IP Ban Store — IP banning, sliding window, auto-ban."""

from __future__ import annotations

import time
from unittest.mock import patch

import pytest

from app.models import BannedIP
from app.services.ip_ban_store import IPBanStore, get_client_ip


# ═══════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════


@pytest.fixture()
def store():
    """Create a fresh IPBanStore for each test."""
    return IPBanStore()


# ═══════════════════════════════════════════════════════════════
# init_banned_ips
# ═══════════════════════════════════════════════════════════════


class TestInitBannedIPs:
    def test_init_loads_banned_ips(self, store: IPBanStore):
        entries = [
            BannedIP(ip="10.0.0.1", reason="test", banned_at="2024-01-01T00:00:00Z"),
            BannedIP(ip="10.0.0.2", reason="test2", banned_at="2024-01-02T00:00:00Z"),
        ]
        store.init_banned_ips(entries)

        assert store.is_banned("10.0.0.1") is True
        assert store.is_banned("10.0.0.2") is True
        assert len(store.get_banned_ips()) == 2

    def test_init_empty_list(self, store: IPBanStore):
        store.init_banned_ips([])
        assert store.get_banned_ips() == []


# ═══════════════════════════════════════════════════════════════
# is_banned
# ═══════════════════════════════════════════════════════════════


class TestIsBanned:
    def test_not_banned_by_default(self, store: IPBanStore):
        assert store.is_banned("10.0.0.1") is False

    def test_banned_after_ban(self, store: IPBanStore):
        store.ban_ip("10.0.0.1")
        assert store.is_banned("10.0.0.1") is True


# ═══════════════════════════════════════════════════════════════
# ban_ip / unban_ip
# ═══════════════════════════════════════════════════════════════


class TestBanUnban:
    def test_ban_ip_returns_entry(self, store: IPBanStore):
        entry = store.ban_ip("10.0.0.1", reason="spam")
        assert entry is not None
        assert entry.ip == "10.0.0.1"
        assert entry.reason == "spam"

    def test_ban_duplicate_returns_none(self, store: IPBanStore):
        store.ban_ip("10.0.0.1")
        result = store.ban_ip("10.0.0.1")
        assert result is None

    def test_unban_ip_removes(self, store: IPBanStore):
        store.ban_ip("10.0.0.1")
        assert store.unban_ip("10.0.0.1") is True
        assert store.is_banned("10.0.0.1") is False

    def test_unban_not_banned_returns_false(self, store: IPBanStore):
        assert store.unban_ip("10.0.0.1") is False

    def test_unban_clears_hit_counter(self, store: IPBanStore):
        store.ban_ip("10.0.0.1")
        store.unban_ip("10.0.0.1")
        assert "10.0.0.1" not in store._hit_counter


# ═══════════════════════════════════════════════════════════════
# record_suspicious_hit (sliding window auto-ban)
# ═══════════════════════════════════════════════════════════════


class TestRecordSuspiciousHit:
    def test_single_hit_no_ban(self, store: IPBanStore):
        with patch("app.services.ip_ban_store.settings") as mock_settings:
            mock_settings.ban_window_seconds = 60
            mock_settings.ban_threshold = 5
            result = store.record_suspicious_hit("10.0.0.1", "test")
            assert result is False
            assert store.is_banned("10.0.0.1") is False

    def test_threshold_reached_auto_bans(self, store: IPBanStore):
        with patch("app.services.ip_ban_store.settings") as mock_settings:
            mock_settings.ban_window_seconds = 60
            mock_settings.ban_threshold = 3

            for i in range(3):
                result = store.record_suspicious_hit("10.0.0.1", f"hit-{i}")

            assert result is True
            assert store.is_banned("10.0.0.1") is True

    def test_already_banned_returns_false(self, store: IPBanStore):
        store.ban_ip("10.0.0.1")
        result = store.record_suspicious_hit("10.0.0.1", "test")
        assert result is False

    def test_old_hits_expire_from_window(self, store: IPBanStore):
        # Mock time.time to simulate window expiry
        base_time = 1000000.0
        with (
            patch("app.services.ip_ban_store.settings") as mock_settings,
            patch("app.services.ip_ban_store.time.time") as mock_time,
        ):
            mock_settings.ban_window_seconds = 60
            mock_settings.ban_threshold = 3

            mock_time.return_value = base_time
            store.record_suspicious_hit("10.0.0.1", "hit-1")
            store.record_suspicious_hit("10.0.0.1", "hit-2")

            # Advance time past the window
            mock_time.return_value = base_time + 61

            # Third hit should not trigger ban since old hits expired
            result = store.record_suspicious_hit("10.0.0.1", "hit-3")
            assert result is False


# ═══════════════════════════════════════════════════════════════
# get_client_ip
# ═══════════════════════════════════════════════════════════════


class TestGetClientIP:
    def test_direct_connection(self):
        request = type("Request", (), {
            "headers": {},
            "client": type("Client", (), {"host": "1.2.3.4"})(),
        })()
        assert get_client_ip(request) == "1.2.3.4"

    def test_x_forwarded_for(self):
        request = type("Request", (), {
            "headers": {"X-Forwarded-For": "5.6.7.8, 9.10.11.12"},
            "client": type("Client", (), {"host": "1.2.3.4"})(),
        })()
        assert get_client_ip(request) == "5.6.7.8"

    def test_x_real_ip(self):
        request = type("Request", (), {
            "headers": {"X-Real-IP": "10.0.0.1"},
            "client": type("Client", (), {"host": "1.2.3.4"})(),
        })()
        assert get_client_ip(request) == "10.0.0.1"

    def test_x_forwarded_for_priority_over_x_real_ip(self):
        request = type("Request", (), {
            "headers": {
                "X-Forwarded-For": "5.6.7.8",
                "X-Real-IP": "10.0.0.1",
            },
            "client": type("Client", (), {"host": "1.2.3.4"})(),
        })()
        assert get_client_ip(request) == "5.6.7.8"

    def test_no_client_returns_unknown(self):
        request = type("Request", (), {
            "headers": {},
            "client": None,
        })()
        assert get_client_ip(request) == "unknown"
