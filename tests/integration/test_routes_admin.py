"""Integration tests for Admin API routes — /api/admin/*."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.dependencies import AppDependencies
from app.services.config_store import ConfigStore
from app.services.account_store import AccountStore
from app.services.metrics_collector import MetricsCollector
from tests.integration.conftest import (
    MockAccountPool,
    MockPoolEntry,
    build_test_app,
)


# ═══════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════


def _make_admin_client(**overrides) -> TestClient:
    """Create a TestClient with admin auth bypassed and service mocks."""
    from app.middleware.auth import admin_auth_dependency

    pool = MockAccountPool()
    mock_store = AsyncMock()
    mock_store.get_time_series.return_value = {"buckets": [], "range": "1h"}
    mock_store.get_breakdown.return_value = {
        "byModel": [],
        "byAccount": [],
        "totals": {"requests": 0, "errors": 0, "avgLatencyMs": 0, "errorRate": 0.0},
    }
    deps = AppDependencies(
        pool=pool,  # type: ignore[arg-type]
        metrics_collector=MetricsCollector(mock_store),
        metrics_store=mock_store,
    )
    app = build_test_app(deps)

    # Bypass admin auth
    async def override_admin_auth():
        return None

    app.dependency_overrides[admin_auth_dependency] = override_admin_auth

    # Apply additional overrides
    for dep, override in overrides.items():
        app.dependency_overrides[dep] = override

    return TestClient(app)


# ═══════════════════════════════════════════════════════════════
# Auth
# ═══════════════════════════════════════════════════════════════


class TestAuth:
    def test_login_success(self):
        client = _make_admin_client()
        # Mock config_store.verify_admin_auth to return True
        client.app.state.deps.config_store.verify_admin_auth = MagicMock(return_value=True)
        client.app.state.deps.session_manager.create_session = MagicMock(return_value="session-token-123")
        resp = client.post("/api/admin/login", json={
            "username": "admin",
            "password": "secret",
        })
        assert resp.status_code == 200
        assert resp.json()["token"] == "session-token-123"

    def test_login_failure(self):
        client = _make_admin_client()
        client.app.state.deps.config_store.verify_admin_auth = MagicMock(return_value=False)
        resp = client.post("/api/admin/login", json={
            "username": "admin",
            "password": "wrong",
        })
        assert resp.status_code == 401

    def test_logout(self):
        client = _make_admin_client()
        mock_destroy = MagicMock()
        client.app.state.deps.session_manager.destroy_session = mock_destroy
        resp = client.post("/api/admin/logout", headers={
            "Authorization": "Bearer session-token-123",
        })
        assert resp.status_code == 200
        assert resp.json()["ok"] is True
        mock_destroy.assert_called_once_with("session-token-123")


# ═══════════════════════════════════════════════════════════════
# Dashboard
# ═══════════════════════════════════════════════════════════════


class TestDashboard:
    def test_dashboard_returns_summary(self):
        from app.models import Account

        accounts_data = [
            Account(
                id="acc-1",
                codex_home="/tmp/acc1",
                enabled=True,
                healthy=True,
                remark="",
                usage_count=5,
                last_used_at=None,
                max_concurrency=3,
            ),
        ]

        client = _make_admin_client()
        client.app.state.deps.account_store.load_accounts = AsyncMock(return_value=accounts_data)
        resp = client.get("/api/admin/dashboard")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert "totalSlots" in data
        assert "activeSlots" in data


# ═══════════════════════════════════════════════════════════════
# Account CRUD
# ═══════════════════════════════════════════════════════════════


class TestAccountCRUD:
    def test_list_accounts(self):
        from app.models import Account

        accounts = [
            Account(
                id="acc-1",
                codex_home="/tmp/acc1",
                enabled=True,
                healthy=True,
                remark="Test",
                usage_count=0,
                last_used_at=None,
                max_concurrency=3,
            ),
        ]

        client = _make_admin_client()
        client.app.state.deps.account_store.load_accounts = AsyncMock(return_value=accounts)
        resp = client.get("/api/admin/accounts")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["accounts"]) == 1
        assert data["accounts"][0]["id"] == "acc-1"

    def test_create_account(self):
        from app.models import Account

        new_acc = Account(
            id="acc-new",
            codex_home="/tmp/new",
            enabled=True,
            healthy=True,
            remark="New",
            usage_count=0,
            last_used_at=None,
            max_concurrency=5,
        )

        client = _make_admin_client()
        client.app.state.deps.account_store.add_account = AsyncMock(return_value=new_acc)
        resp = client.post("/api/admin/accounts", json={
            "codex_home": "/tmp/new",
            "remark": "New",
            "max_concurrency": 5,
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == "acc-new"

    def test_update_account(self):
        from app.models import Account

        updated = Account(
            id="acc-1",
            codex_home="/tmp/acc1",
            enabled=False,
            healthy=False,
            remark="Updated",
            usage_count=0,
            last_used_at=None,
            max_concurrency=10,
        )

        client = _make_admin_client()
        client.app.state.deps.account_store.update_account = AsyncMock(return_value=updated)
        resp = client.patch("/api/admin/accounts/acc-1", json={
            "remark": "Updated",
            "enabled": False,
        })
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_update_account_not_found(self):
        client = _make_admin_client()
        client.app.state.deps.account_store.update_account = AsyncMock(return_value=None)
        resp = client.patch("/api/admin/accounts/nonexistent", json={
            "remark": "X",
        })
        assert resp.status_code == 404

    def test_delete_account(self):
        client = _make_admin_client()
        client.app.state.deps.account_store.remove_account = AsyncMock(return_value=True)
        resp = client.delete("/api/admin/accounts/acc-1")
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_delete_account_not_found(self):
        client = _make_admin_client()
        client.app.state.deps.account_store.remove_account = AsyncMock(return_value=False)
        resp = client.delete("/api/admin/accounts/acc-1")
        assert resp.status_code == 404

    def test_export_accounts(self):
        from app.models import Account

        accounts = [
            Account(
                id="acc-1",
                codex_home="/tmp/acc1",
                enabled=True,
                healthy=True,
                remark="",
                usage_count=0,
                last_used_at=None,
                max_concurrency=3,
            ),
        ]

        client = _make_admin_client()
        client.app.state.deps.account_store.load_accounts = AsyncMock(return_value=accounts)
        resp = client.get("/api/admin/accounts/export")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["accounts"]) == 1

    def test_backup_all(self):
        from app.models import Account

        accounts = [Account(
            id="acc-1", codex_home="/tmp/acc1", enabled=True, healthy=True,
            remark="", usage_count=0, last_used_at=None, max_concurrency=3,
        )]

        client = _make_admin_client()
        client.app.state.deps.account_store.load_accounts = AsyncMock(return_value=accounts)
        client.app.state.deps.config_store.get_api_keys = MagicMock(return_value=[])
        client.app.state.deps.config_store.get_default_models = MagicMock(return_value=["gpt-5.5"])
        resp = client.get("/api/admin/backup")
        assert resp.status_code == 200
        data = resp.json()
        assert "accounts" in data
        assert "apiKeys" in data
        assert "defaultModels" in data


# ═══════════════════════════════════════════════════════════════
# API Key CRUD
# ═══════════════════════════════════════════════════════════════


class TestApiKeyCRUD:
    def test_list_api_keys(self):
        from app.models import ApiKeyEntry

        keys = [
            ApiKeyEntry(
                key="sk-test-key-12345678",
                name="Test Key",
                models=["gpt-5.5"],
                created_at="2024-01-01T00:00:00Z",
            ),
        ]

        client = _make_admin_client()
        client.app.state.deps.config_store.get_api_keys = MagicMock(return_value=keys)
        client.app.state.deps.config_store.get_default_models = MagicMock(return_value=["gpt-5.5"])
        resp = client.get("/api/admin/keys")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["keys"]) == 1
        assert "keyMasked" in data["keys"][0]

    def test_create_api_key(self):
        from app.models import ApiKeyEntry

        entry = ApiKeyEntry(
            key="sk-generated-key",
            name="New Key",
            models=["gpt-5.5"],
            created_at="2024-01-01T00:00:00Z",
        )

        client = _make_admin_client()
        client.app.state.deps.config_store.add_api_key = AsyncMock(return_value=entry)
        resp = client.post("/api/admin/keys", json={
            "name": "New Key",
            "models": ["gpt-5.5"],
        })
        assert resp.status_code == 200
        assert resp.json()["key"] == "sk-generated-key"

    def test_update_api_key(self):
        from app.models import ApiKeyEntry

        entry = ApiKeyEntry(
            key="sk-test-key-12345678",
            name="Updated Key",
            models=["gpt-5.5"],
            created_at="2024-01-01T00:00:00Z",
        )

        client = _make_admin_client()
        client.app.state.deps.config_store.get_api_keys = MagicMock(return_value=[entry])
        client.app.state.deps.config_store.update_api_key = AsyncMock(return_value=entry)
        resp = client.patch("/api/admin/keys/sk-test-key-12", json={"name": "Updated Key"})
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_update_api_key_not_found(self):
        client = _make_admin_client()
        client.app.state.deps.config_store.get_api_keys = MagicMock(return_value=[])
        resp = client.patch("/api/admin/keys/sk-test", json={"name": "X"})
        assert resp.status_code == 404

    def test_delete_api_key(self):
        from app.models import ApiKeyEntry

        entry = ApiKeyEntry(
            key="sk-test-key-12345678",
            name="Test Key",
            models=[],
            created_at="2024-01-01T00:00:00Z",
        )

        client = _make_admin_client()
        client.app.state.deps.config_store.get_api_keys = MagicMock(return_value=[entry])
        client.app.state.deps.config_store.remove_api_key = AsyncMock(return_value=True)
        resp = client.delete("/api/admin/keys/sk-test-key-12")
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_delete_api_key_not_found(self):
        client = _make_admin_client()
        client.app.state.deps.config_store.get_api_keys = MagicMock(return_value=[])
        resp = client.delete("/api/admin/keys/sk-test")
        assert resp.status_code == 404

    def test_reveal_api_key_success(self):
        from app.models import ApiKeyEntry

        entry = ApiKeyEntry(
            key="sk-full-key-here123",
            name="Test Key",
            models=[],
            created_at="2024-01-01T00:00:00Z",
        )

        client = _make_admin_client()
        client.app.state.deps.config_store.verify_admin_password = MagicMock(return_value=True)
        client.app.state.deps.config_store.get_api_keys = MagicMock(return_value=[entry])
        resp = client.post("/api/admin/keys/reveal", json={
            "key_prefix": "sk-full-key-h",
            "password": "secret",
        })
        assert resp.status_code == 200
        assert resp.json()["key"] == "sk-full-key-here123"

    def test_reveal_api_key_wrong_password(self):
        client = _make_admin_client()
        client.app.state.deps.config_store.verify_admin_password = MagicMock(return_value=False)
        resp = client.post("/api/admin/keys/reveal", json={
            "key_prefix": "sk-test",
            "password": "wrong",
        })
        assert resp.status_code == 403


# ═══════════════════════════════════════════════════════════════
# Models CRUD
# ═══════════════════════════════════════════════════════════════


class TestModelsCRUD:
    def test_list_models(self):
        client = _make_admin_client()
        client.app.state.deps.config_store.get_default_models = MagicMock(return_value=["gpt-5.5", "gpt-5.4"])
        resp = client.get("/api/admin/models")
        assert resp.status_code == 200
        assert resp.json()["models"] == ["gpt-5.5", "gpt-5.4"]

    def test_add_model(self):
        client = _make_admin_client()
        client.app.state.deps.config_store.add_default_model = AsyncMock(return_value=True)
        client.app.state.deps.config_store.get_default_models = MagicMock(return_value=["gpt-5.5", "gpt-5.6"])
        resp = client.post("/api/admin/models", json={"model": "gpt-5.6"})
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_add_duplicate_model(self):
        client = _make_admin_client()
        client.app.state.deps.config_store.add_default_model = AsyncMock(return_value=False)
        resp = client.post("/api/admin/models", json={"model": "gpt-5.5"})
        assert resp.status_code == 409

    def test_add_empty_model(self):
        client = _make_admin_client()
        resp = client.post("/api/admin/models", json={"model": "  "})
        assert resp.status_code == 400

    def test_delete_model(self):
        client = _make_admin_client()
        client.app.state.deps.config_store.remove_default_model = AsyncMock(return_value=True)
        client.app.state.deps.config_store.get_default_models = MagicMock(return_value=["gpt-5.5"])
        resp = client.delete("/api/admin/models/gpt-5.4")
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_delete_model_not_found(self):
        client = _make_admin_client()
        client.app.state.deps.config_store.remove_default_model = AsyncMock(return_value=False)
        resp = client.delete("/api/admin/models/gpt-99")
        assert resp.status_code == 404


# ═══════════════════════════════════════════════════════════════
# Pool Status
# ═══════════════════════════════════════════════════════════════


class TestPoolStatus:
    def test_pool_status(self):
        client = _make_admin_client()
        resp = client.get("/api/admin/pool-status")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) >= 1


# ═══════════════════════════════════════════════════════════════
# Metrics
# ═══════════════════════════════════════════════════════════════


class TestMetrics:
    def test_timeseries(self):
        client = _make_admin_client()
        resp = client.get("/api/admin/metrics/timeseries?range=1h")
        assert resp.status_code == 200
        data = resp.json()
        assert "buckets" in data

    def test_breakdown(self):
        client = _make_admin_client()
        resp = client.get("/api/admin/metrics/breakdown")
        assert resp.status_code == 200
        data = resp.json()
        assert "byModel" in data


# ═══════════════════════════════════════════════════════════════
# Banned IPs
# ═══════════════════════════════════════════════════════════════


class TestBannedIPs:
    def test_list_banned_ips(self):
        from app.models import BannedIP

        banned = [BannedIP(ip="10.0.0.1", reason="test", banned_at="2024-01-01T00:00:00Z")]

        client = _make_admin_client()
        client.app.state.deps.ip_ban_store.get_banned_ips = MagicMock(return_value=banned)
        resp = client.get("/api/admin/banned-ips")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["bannedIps"]) == 1

    def test_add_banned_ip(self):
        from app.models import BannedIP

        entry = BannedIP(ip="10.0.0.1", reason="spam", banned_at="2024-01-01T00:00:00Z")

        client = _make_admin_client()
        client.app.state.deps.ip_ban_store.ban_ip = MagicMock(return_value=entry)
        client.app.state.deps.ip_ban_store.get_banned_ips = MagicMock(return_value=[entry])
        client.app.state.deps.config_store.save_banned_ips = AsyncMock()
        resp = client.post("/api/admin/banned-ips", json={
            "ip": "10.0.0.1",
            "reason": "spam",
        })
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_add_banned_ip_empty(self):
        client = _make_admin_client()
        resp = client.post("/api/admin/banned-ips", json={"ip": "  ", "reason": ""})
        assert resp.status_code == 400

    def test_add_banned_ip_duplicate(self):
        client = _make_admin_client()
        client.app.state.deps.ip_ban_store.ban_ip = MagicMock(return_value=None)
        resp = client.post("/api/admin/banned-ips", json={
            "ip": "10.0.0.1",
            "reason": "spam",
        })
        assert resp.status_code == 409

    def test_remove_banned_ip(self):
        client = _make_admin_client()
        client.app.state.deps.ip_ban_store.unban_ip = MagicMock(return_value=True)
        client.app.state.deps.ip_ban_store.get_banned_ips = MagicMock(return_value=[])
        client.app.state.deps.config_store.save_banned_ips = AsyncMock()
        resp = client.delete("/api/admin/banned-ips/10.0.0.1")
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_remove_banned_ip_not_found(self):
        client = _make_admin_client()
        client.app.state.deps.ip_ban_store.unban_ip = MagicMock(return_value=False)
        resp = client.delete("/api/admin/banned-ips/10.0.0.1")
        assert resp.status_code == 404
