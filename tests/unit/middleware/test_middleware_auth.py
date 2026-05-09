"""Tests for authentication middleware (api_key_auth_dependency, admin_auth_dependency)."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException, Request


# ═══════════════════════════════════════════════════════════════
# api_key_auth_dependency tests
# ═══════════════════════════════════════════════════════════════


class TestApiKeyAuthDependency:
    """Tests for api_key_auth_dependency — API key validation."""

    @pytest.fixture
    def mock_config(self):
        """Mock config_store functions used by auth middleware."""
        with (
            patch(
                "app.middleware.auth.get_api_key_set",
                return_value={"sk-test-key-12345678", "sk-another-key"},
            ),
            patch(
                "app.middleware.auth.find_api_key",
                return_value=None,
            ),
        ):
            yield

    @pytest.mark.asyncio
    async def test_valid_api_key(self, mock_config):
        """Valid Bearer token should return the API key string."""
        from app.middleware.auth import api_key_auth_dependency

        request = MagicMock(spec=Request)
        request.headers = {"Authorization": "Bearer sk-test-key-12345678"}

        result = await api_key_auth_dependency(request)
        assert result == "sk-test-key-12345678"

    @pytest.mark.asyncio
    async def test_missing_authorization_header(self, mock_config):
        """Missing Authorization header should raise 401."""
        from app.middleware.auth import api_key_auth_dependency

        request = MagicMock(spec=Request)
        request.headers = {}

        with pytest.raises(HTTPException) as exc_info:
            await api_key_auth_dependency(request)
        assert exc_info.value.status_code == 401
        assert "Missing Authorization header" in exc_info.value.detail["error"]["message"]

    @pytest.mark.asyncio
    async def test_invalid_header_format(self, mock_config):
        """Non-Bearer Authorization header should raise 401."""
        from app.middleware.auth import api_key_auth_dependency

        request = MagicMock(spec=Request)
        request.headers = {"Authorization": "Basic dXNlcjpwYXNz"}

        with pytest.raises(HTTPException) as exc_info:
            await api_key_auth_dependency(request)
        assert exc_info.value.status_code == 401
        assert "Invalid Authorization header format" in exc_info.value.detail["error"]["message"]

    @pytest.mark.asyncio
    async def test_invalid_api_key(self, mock_config):
        """Unknown API key should raise 401."""
        from app.middleware.auth import api_key_auth_dependency

        request = MagicMock(spec=Request)
        request.headers = {"Authorization": "Bearer sk-unknown-key"}

        with pytest.raises(HTTPException) as exc_info:
            await api_key_auth_dependency(request)
        assert exc_info.value.status_code == 401
        assert "Invalid API key" in exc_info.value.detail["error"]["message"]

    @pytest.mark.asyncio
    async def test_no_api_keys_configured(self):
        """Empty API key set should raise 401."""
        from app.middleware.auth import api_key_auth_dependency

        request = MagicMock(spec=Request)
        request.headers = {"Authorization": "Bearer sk-test-key-12345678"}

        with patch("app.middleware.auth.get_api_key_set", return_value=set()):
            with pytest.raises(HTTPException) as exc_info:
                await api_key_auth_dependency(request)
        assert exc_info.value.status_code == 401
        assert "No API keys configured" in exc_info.value.detail["error"]["message"]

    @pytest.mark.asyncio
    async def test_ip_whitelist_blocked(self):
        """IP not in whitelist should raise 403."""
        from app.middleware.auth import api_key_auth_dependency
        from app.models import ApiKeyEntry

        mock_entry = ApiKeyEntry(
            key="sk-test-key-12345678",
            name="test",
            models=[],
            created_at="2024-01-01T00:00:00Z",
            ip_whitelist=["10.0.0.1"],
        )

        request = MagicMock(spec=Request)
        request.headers = {
            "Authorization": "Bearer sk-test-key-12345678",
            "x-forwarded-for": "192.168.1.1",
        }
        request.client = MagicMock()
        request.client.host = "192.168.1.1"

        with (
            patch(
                "app.middleware.auth.get_api_key_set",
                return_value={"sk-test-key-12345678"},
            ),
            patch("app.middleware.auth.find_api_key", return_value=mock_entry),
        ):
            with pytest.raises(HTTPException) as exc_info:
                await api_key_auth_dependency(request)
        assert exc_info.value.status_code == 403
        assert "IP not allowed" in exc_info.value.detail["error"]["message"]

    @pytest.mark.asyncio
    async def test_ip_whitelist_allowed(self):
        """IP in whitelist should pass."""
        from app.middleware.auth import api_key_auth_dependency
        from app.models import ApiKeyEntry

        mock_entry = ApiKeyEntry(
            key="sk-test-key-12345678",
            name="test",
            models=[],
            created_at="2024-01-01T00:00:00Z",
            ip_whitelist=["10.0.0.1"],
        )

        request = MagicMock(spec=Request)
        request.headers = {
            "Authorization": "Bearer sk-test-key-12345678",
            "x-forwarded-for": "10.0.0.1",
        }
        request.client = MagicMock()
        request.client.host = "10.0.0.1"

        with (
            patch(
                "app.middleware.auth.get_api_key_set",
                return_value={"sk-test-key-12345678"},
            ),
            patch("app.middleware.auth.find_api_key", return_value=mock_entry),
        ):
            result = await api_key_auth_dependency(request)
        assert result == "sk-test-key-12345678"

    @pytest.mark.asyncio
    async def test_monthly_quota_exceeded(self):
        """Monthly quota exceeded should raise 429."""
        from app.middleware.auth import api_key_auth_dependency
        from datetime import datetime, timedelta, timezone

        from app.models import ApiKeyEntry

        future_reset = (datetime.now(timezone.utc) + timedelta(days=10)).isoformat()
        mock_entry = ApiKeyEntry(
            key="sk-test-key-12345678",
            name="test",
            models=[],
            created_at="2024-01-01T00:00:00Z",
            monthly_quota=100,
            monthly_usage=100,
            monthly_reset_at=future_reset,
        )

        request = MagicMock(spec=Request)
        request.headers = {"Authorization": "Bearer sk-test-key-12345678"}

        with (
            patch(
                "app.middleware.auth.get_api_key_set",
                return_value={"sk-test-key-12345678"},
            ),
            patch("app.middleware.auth.find_api_key", return_value=mock_entry),
        ):
            with pytest.raises(HTTPException) as exc_info:
                await api_key_auth_dependency(request)
        assert exc_info.value.status_code == 429
        assert "Monthly quota exceeded" in exc_info.value.detail["error"]["message"]


# ═══════════════════════════════════════════════════════════════
# admin_auth_dependency tests
# ═══════════════════════════════════════════════════════════════


class TestAdminAuthDependency:
    """Tests for admin_auth_dependency — admin session/auth validation."""

    @pytest.mark.asyncio
    async def test_valid_bearer_token(self):
        """Valid session token via Bearer should pass."""
        from app.middleware.auth import admin_auth_dependency

        request = MagicMock(spec=Request)
        request.headers = {"Authorization": "Bearer valid-session-token"}
        request.query_params = {}

        with patch("app.middleware.auth.validate_session", return_value=True):
            await admin_auth_dependency(request)

    @pytest.mark.asyncio
    async def test_valid_query_token(self):
        """Valid session token via query param should pass."""
        from app.middleware.auth import admin_auth_dependency

        request = MagicMock(spec=Request)
        request.query_params = {"token": "valid-session-token"}
        request.headers = {}

        with patch("app.middleware.auth.validate_session", return_value=True):
            await admin_auth_dependency(request)

    @pytest.mark.asyncio
    async def test_invalid_bearer_token(self):
        """Invalid session token should raise 401."""
        from app.middleware.auth import admin_auth_dependency

        request = MagicMock(spec=Request)
        request.headers = {"Authorization": "Bearer invalid-token"}
        request.query_params = {}

        with patch("app.middleware.auth.validate_session", return_value=False):
            with pytest.raises(HTTPException) as exc_info:
                await admin_auth_dependency(request)
        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_missing_auth_header(self):
        """Missing Authorization header should raise 401."""
        from app.middleware.auth import admin_auth_dependency

        request = MagicMock(spec=Request)
        request.headers = {}
        request.query_params = {}

        with pytest.raises(HTTPException) as exc_info:
            await admin_auth_dependency(request)
        assert exc_info.value.status_code == 401
        assert "Missing Authorization header" in exc_info.value.detail["error"]["message"]

    @pytest.mark.asyncio
    async def test_valid_basic_auth(self):
        """Valid Basic auth credentials should pass."""
        import base64

        from app.middleware.auth import admin_auth_dependency

        credentials = base64.b64encode(b"admin:admin").decode("utf-8")
        request = MagicMock(spec=Request)
        request.headers = {"Authorization": f"Basic {credentials}"}
        request.query_params = {}

        with patch("app.middleware.auth.verify_admin_auth", return_value=True):
            await admin_auth_dependency(request)

    @pytest.mark.asyncio
    async def test_invalid_basic_auth(self):
        """Invalid Basic auth credentials should raise 401."""
        import base64

        from app.middleware.auth import admin_auth_dependency

        credentials = base64.b64encode(b"admin:wrong").decode("utf-8")
        request = MagicMock(spec=Request)
        request.headers = {"Authorization": f"Basic {credentials}"}
        request.query_params = {}

        with patch("app.middleware.auth.verify_admin_auth", return_value=False):
            with pytest.raises(HTTPException) as exc_info:
                await admin_auth_dependency(request)
        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_invalid_basic_auth_encoding(self):
        """Malformed Basic auth encoding should raise 401."""
        from app.middleware.auth import admin_auth_dependency

        request = MagicMock(spec=Request)
        request.headers = {"Authorization": "Basic not-valid-base64!!!"}
        request.query_params = {}

        with pytest.raises(HTTPException) as exc_info:
            await admin_auth_dependency(request)
        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_invalid_auth_header_format(self):
        """Unrecognized auth scheme should raise 401."""
        from app.middleware.auth import admin_auth_dependency

        request = MagicMock(spec=Request)
        request.headers = {"Authorization": "Digest something"}
        request.query_params = {}

        with pytest.raises(HTTPException) as exc_info:
            await admin_auth_dependency(request)
        assert exc_info.value.status_code == 401
        assert "Invalid Authorization header format" in exc_info.value.detail["error"]["message"]
