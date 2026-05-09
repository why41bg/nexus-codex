"""Integration tests for Admin API routes — /api/admin/*."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.dependencies import AppDependencies
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
    from unittest.mock import MagicMock
    from app.middleware.auth import admin_auth_dependency

    pool = MockAccountPool()
    mock_store = MagicMock()
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
        from app.services.config_store import verify_admin_auth

        with patch("app.routes.admin.verify_admin_auth", return_value=True):
            with patch("app.routes.admin.create_session", return_value="session-token-123"):
                client = _make_admin_client()
                resp = client.post("/api/admin/login", json={
                    "username": "admin",
                    "password": "secret",
                })
                assert resp.status_code == 200
                assert resp.json()["token"] == "session-token-123"

    def test_login_failure(self):
        with patch("app.routes.admin.verify_admin_auth", return_value=False):
            client = _make_admin_client()
            resp = client.post("/api/admin/login", json={
                "username": "admin",
                "password": "wrong",
            })
            assert resp.status_code == 401

    def test_logout(self):
        with patch("app.routes.admin.destroy_session") as mock_destroy:
            client = _make_admin_client()
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
        accounts_data = [
            {
                "id": "acc-1",
                "codex_home": "/tmp/acc1",
                "enabled": True,
                "healthy": True,
                "remark": "",
                "usage_count": 5,
                "last_used_at": None,
                "max_concurrency": 3,
            },
        ]

        with patch("app.routes.admin.load_accounts", new_callable=AsyncMock) as mock_load:
            from app.models import Account
            mock_load.return_value = [Account(**a) for a in accounts_data]

            client = _make_admin_client()
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

        with patch("app.routes.admin.load_accounts", new_callable=AsyncMock) as mock_load:
            mock_load.return_value = accounts
            client = _make_admin_client()
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

        with patch("app.routes.admin.add_account", new_callable=AsyncMock) as mock_add:
            mock_add.return_value = new_acc
            client = _make_admin_client()
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

        with patch("app.routes.admin.update_account", new_callable=AsyncMock) as mock_update:
            mock_update.return_value = updated
            client = _make_admin_client()
            resp = client.patch("/api/admin/accounts/acc-1", json={
                "remark": "Updated",
                "enabled": False,
            })
            assert resp.status_code == 200
            assert resp.json()["ok"] is True

    def test_update_account_not_found(self):
        with patch("app.routes.admin.update_account", new_callable=AsyncMock) as mock_update:
            mock_update.return_value = None
            client = _make_admin_client()
            resp = client.patch("/api/admin/accounts/nonexistent", json={
                "remark": "X",
            })
            assert resp.status_code == 404

    def test_delete_account(self):
        with patch("app.routes.admin.remove_account", new_callable=AsyncMock) as mock_remove:
            mock_remove.return_value = True
            client = _make_admin_client()
            resp = client.delete("/api/admin/accounts/acc-1")
            assert resp.status_code == 200
            assert resp.json()["ok"] is True

    def test_delete_account_not_found(self):
        with patch("app.routes.admin.remove_account", new_callable=AsyncMock) as mock_remove:
            mock_remove.return_value = False
            client = _make_admin_client()
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

        with patch("app.routes.admin.load_accounts", new_callable=AsyncMock) as mock_load:
            mock_load.return_value = accounts
            client = _make_admin_client()
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

        with (
            patch("app.routes.admin.load_accounts", new_callable=AsyncMock) as mock_load,
            patch("app.routes.admin.get_api_keys", return_value=[]),
            patch("app.routes.admin.get_default_models", return_value=["gpt-5.5"]),
        ):
            mock_load.return_value = accounts
            client = _make_admin_client()
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

        with patch("app.routes.admin.get_api_keys", return_value=keys):
            with patch("app.routes.admin.get_default_models", return_value=["gpt-5.5"]):
                client = _make_admin_client()
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

        with patch("app.routes.admin.add_api_key", new_callable=AsyncMock) as mock_add:
            mock_add.return_value = entry
            client = _make_admin_client()
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

        with (
            patch("app.routes.admin._resolve_key", return_value="sk-test-key-12345678"),
            patch("app.routes.admin.update_api_key", new_callable=AsyncMock) as mock_update,
        ):
            mock_update.return_value = entry
            client = _make_admin_client()
            resp = client.patch("/api/admin/keys/sk-test", json={"name": "Updated Key"})
            assert resp.status_code == 200
            assert resp.json()["ok"] is True

    def test_update_api_key_not_found(self):
        with (
            patch("app.routes.admin._resolve_key", return_value=None),
        ):
            client = _make_admin_client()
            resp = client.patch("/api/admin/keys/sk-test", json={"name": "X"})
            assert resp.status_code == 404

    def test_delete_api_key(self):
        with (
            patch("app.routes.admin._resolve_key", return_value="sk-test-key-12345678"),
            patch("app.routes.admin.remove_api_key", new_callable=AsyncMock) as mock_remove,
        ):
            mock_remove.return_value = True
            client = _make_admin_client()
            resp = client.delete("/api/admin/keys/sk-test")
            assert resp.status_code == 200
            assert resp.json()["ok"] is True

    def test_delete_api_key_not_found(self):
        with (
            patch("app.routes.admin._resolve_key", return_value=None),
        ):
            client = _make_admin_client()
            resp = client.delete("/api/admin/keys/sk-test")
            assert resp.status_code == 404

    def test_reveal_api_key_success(self):
        with (
            patch("app.routes.admin.verify_admin_password", return_value=True),
            patch("app.routes.admin._resolve_key", return_value="sk-full-key-here"),
        ):
            client = _make_admin_client()
            resp = client.post("/api/admin/keys/reveal", json={
                "key_prefix": "sk-test",
                "password": "secret",
            })
            assert resp.status_code == 200
            assert resp.json()["key"] == "sk-full-key-here"

    def test_reveal_api_key_wrong_password(self):
        with patch("app.routes.admin.verify_admin_password", return_value=False):
            client = _make_admin_client()
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
        with patch("app.routes.admin.get_default_models", return_value=["gpt-5.5", "gpt-5.4"]):
            client = _make_admin_client()
            resp = client.get("/api/admin/models")
            assert resp.status_code == 200
            assert resp.json()["models"] == ["gpt-5.5", "gpt-5.4"]

    def test_add_model(self):
        with patch("app.routes.admin.add_default_model", new_callable=AsyncMock) as mock_add:
            mock_add.return_value = True
            with patch("app.routes.admin.get_default_models", return_value=["gpt-5.5", "gpt-5.6"]):
                client = _make_admin_client()
                resp = client.post("/api/admin/models", json={"model": "gpt-5.6"})
                assert resp.status_code == 200
                assert resp.json()["ok"] is True

    def test_add_duplicate_model(self):
        with patch("app.routes.admin.add_default_model", new_callable=AsyncMock) as mock_add:
            mock_add.return_value = False
            client = _make_admin_client()
            resp = client.post("/api/admin/models", json={"model": "gpt-5.5"})
            assert resp.status_code == 409

    def test_add_empty_model(self):
        client = _make_admin_client()
        resp = client.post("/api/admin/models", json={"model": "  "})
        assert resp.status_code == 400

    def test_delete_model(self):
        with patch("app.routes.admin.remove_default_model", new_callable=AsyncMock) as mock_remove:
            mock_remove.return_value = True
            with patch("app.routes.admin.get_default_models", return_value=["gpt-5.5"]):
                client = _make_admin_client()
                resp = client.delete("/api/admin/models/gpt-5.4")
                assert resp.status_code == 200
                assert resp.json()["ok"] is True

    def test_delete_model_not_found(self):
        with patch("app.routes.admin.remove_default_model", new_callable=AsyncMock) as mock_remove:
            mock_remove.return_value = False
            client = _make_admin_client()
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

        with patch("app.routes.admin.get_banned_ips", return_value=banned):
            client = _make_admin_client()
            resp = client.get("/api/admin/banned-ips")
            assert resp.status_code == 200
            data = resp.json()
            assert len(data["bannedIps"]) == 1

    def test_add_banned_ip(self):
        from app.models import BannedIP

        entry = BannedIP(ip="10.0.0.1", reason="spam", banned_at="2024-01-01T00:00:00Z")

        with (
            patch("app.routes.admin.ban_ip", return_value=entry),
            patch("app.routes.admin.save_banned_ips", new_callable=AsyncMock),
            patch("app.routes.admin.get_banned_ips", return_value=[entry]),
        ):
            client = _make_admin_client()
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
        with patch("app.routes.admin.ban_ip", return_value=None):
            client = _make_admin_client()
            resp = client.post("/api/admin/banned-ips", json={
                "ip": "10.0.0.1",
                "reason": "spam",
            })
            assert resp.status_code == 409

    def test_remove_banned_ip(self):
        with (
            patch("app.routes.admin.unban_ip", return_value=True),
            patch("app.routes.admin.save_banned_ips", new_callable=AsyncMock),
            patch("app.routes.admin.get_banned_ips", return_value=[]),
        ):
            client = _make_admin_client()
            resp = client.delete("/api/admin/banned-ips/10.0.0.1")
            assert resp.status_code == 200
            assert resp.json()["ok"] is True

    def test_remove_banned_ip_not_found(self):
        with patch("app.routes.admin.unban_ip", return_value=False):
            client = _make_admin_client()
            resp = client.delete("/api/admin/banned-ips/10.0.0.1")
            assert resp.status_code == 404
