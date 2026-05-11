"""Tests for authentication middleware (api_key_auth_dependency, admin_auth_dependency)."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException, Request


# ═══════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════


def _make_request(
    headers: dict | None = None,
    query_params: dict | None = None,
    *,
    config_store: MagicMock | None = None,
    session_manager: MagicMock | None = None,
) -> MagicMock:
    """Build a mock Request with deps.config_store pre-configured."""
    request = MagicMock(spec=Request)
    request.headers = headers or {}
    request.query_params = query_params or {}

    mock_deps = MagicMock()
    if config_store is not None:
        mock_deps.config_store = config_store
    else:
        mock_deps.config_store = MagicMock()
    if session_manager is not None:
        mock_deps.session_manager = session_manager
    else:
        mock_deps.session_manager = MagicMock()

    request.app.state.deps = mock_deps
    return request


def _make_config_store(
    api_key_set: set[str] | None = None,
    find_api_key_return=None,
    verify_admin_auth_return: bool = False,
) -> MagicMock:
    """Build a mock ConfigStore."""
    store = MagicMock()
    store.get_api_key_set = MagicMock(return_value=api_key_set if api_key_set is not None else set())
    store.find_api_key = MagicMock(return_value=find_api_key_return)
    store.verify_admin_auth = MagicMock(return_value=verify_admin_auth_return)
    return store


# ═══════════════════════════════════════════════════════════════
# api_key_auth_dependency tests
# ═══════════════════════════════════════════════════════════════


class TestApiKeyAuthDependency:
    """Tests for api_key_auth_dependency — API key validation."""

    @pytest.mark.asyncio
    async def test_valid_api_key(self):
        """Valid Bearer token should return the API key string."""
        from app.middleware.auth import api_key_auth_dependency

        store = _make_config_store(
            api_key_set={"sk-test-key-12345678", "sk-another-key"},
        )
        request = _make_request(
            headers={"Authorization": "Bearer sk-test-key-12345678"},
            config_store=store,
        )

        result = await api_key_auth_dependency(request)
        assert result == "sk-test-key-12345678"

    @pytest.mark.asyncio
    async def test_missing_authorization_header(self):
        """Missing Authorization header should raise 401."""
        from app.middleware.auth import api_key_auth_dependency

        store = _make_config_store(
            api_key_set={"sk-test-key-12345678"},
        )
        request = _make_request(headers={}, config_store=store)

        with pytest.raises(HTTPException) as exc_info:
            await api_key_auth_dependency(request)
        assert exc_info.value.status_code == 401
        assert "Missing Authorization header" in exc_info.value.detail["error"]["message"]

    @pytest.mark.asyncio
    async def test_invalid_header_format(self):
        """Non-Bearer Authorization header should raise 401."""
        from app.middleware.auth import api_key_auth_dependency

        store = _make_config_store(
            api_key_set={"sk-test-key-12345678"},
        )
        request = _make_request(
            headers={"Authorization": "Basic dXNlcjpwYXNz"},
            config_store=store,
        )

        with pytest.raises(HTTPException) as exc_info:
            await api_key_auth_dependency(request)
        assert exc_info.value.status_code == 401
        assert "Invalid Authorization header format" in exc_info.value.detail["error"]["message"]

    @pytest.mark.asyncio
    async def test_invalid_api_key(self):
        """Unknown API key should raise 401."""
        from app.middleware.auth import api_key_auth_dependency

        store = _make_config_store(
            api_key_set={"sk-test-key-12345678", "sk-another-key"},
        )
        request = _make_request(
            headers={"Authorization": "Bearer sk-unknown-key"},
            config_store=store,
        )

        with pytest.raises(HTTPException) as exc_info:
            await api_key_auth_dependency(request)
        assert exc_info.value.status_code == 401
        assert "Invalid API key" in exc_info.value.detail["error"]["message"]

    @pytest.mark.asyncio
    async def test_no_api_keys_configured(self):
        """Empty API key set should raise 401."""
        from app.middleware.auth import api_key_auth_dependency

        store = _make_config_store(api_key_set=set())
        request = _make_request(
            headers={"Authorization": "Bearer sk-test-key-12345678"},
            config_store=store,
        )

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

        store = _make_config_store(
            api_key_set={"sk-test-key-12345678"},
            find_api_key_return=mock_entry,
        )
        request = _make_request(
            headers={
                "Authorization": "Bearer sk-test-key-12345678",
                "x-forwarded-for": "192.168.1.1",
            },
            config_store=store,
        )
        request.client = MagicMock()
        request.client.host = "192.168.1.1"

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

        store = _make_config_store(
            api_key_set={"sk-test-key-12345678"},
            find_api_key_return=mock_entry,
        )
        request = _make_request(
            headers={
                "Authorization": "Bearer sk-test-key-12345678",
                "x-forwarded-for": "10.0.0.1",
            },
            config_store=store,
        )
        request.client = MagicMock()
        request.client.host = "10.0.0.1"

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

        store = _make_config_store(
            api_key_set={"sk-test-key-12345678"},
            find_api_key_return=mock_entry,
        )
        request = _make_request(
            headers={"Authorization": "Bearer sk-test-key-12345678"},
            config_store=store,
        )

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

        mock_session_mgr = MagicMock()
        mock_session_mgr.validate_session.return_value = True

        request = _make_request(
            headers={"Authorization": "Bearer valid-session-token"},
            session_manager=mock_session_mgr,
        )

        await admin_auth_dependency(request)

    @pytest.mark.asyncio
    async def test_valid_query_token(self):
        """Valid session token via query param should pass."""
        from app.middleware.auth import admin_auth_dependency

        mock_session_mgr = MagicMock()
        mock_session_mgr.validate_session.return_value = True

        request = _make_request(
            headers={},
            query_params={"token": "valid-session-token"},
            session_manager=mock_session_mgr,
        )

        await admin_auth_dependency(request)

    @pytest.mark.asyncio
    async def test_invalid_bearer_token(self):
        """Invalid session token should raise 401."""
        from app.middleware.auth import admin_auth_dependency

        mock_session_mgr = MagicMock()
        mock_session_mgr.validate_session.return_value = False

        request = _make_request(
            headers={"Authorization": "Bearer invalid-token"},
            session_manager=mock_session_mgr,
        )

        with pytest.raises(HTTPException) as exc_info:
            await admin_auth_dependency(request)
        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_missing_auth_header(self):
        """Missing Authorization header should raise 401."""
        from app.middleware.auth import admin_auth_dependency

        request = _make_request(headers={})

        with pytest.raises(HTTPException) as exc_info:
            await admin_auth_dependency(request)
        assert exc_info.value.status_code == 401
        assert "Missing Authorization header" in exc_info.value.detail["error"]["message"]

    @pytest.mark.asyncio
    async def test_valid_basic_auth(self):
        """Valid Basic auth credentials should pass."""
        import base64

        from app.middleware.auth import admin_auth_dependency

        store = _make_config_store(verify_admin_auth_return=True)
        credentials = base64.b64encode(b"admin:admin").decode("utf-8")
        request = _make_request(
            headers={"Authorization": f"Basic {credentials}"},
            config_store=store,
        )

        await admin_auth_dependency(request)

    @pytest.mark.asyncio
    async def test_invalid_basic_auth(self):
        """Invalid Basic auth credentials should raise 401."""
        import base64

        from app.middleware.auth import admin_auth_dependency

        store = _make_config_store(verify_admin_auth_return=False)
        credentials = base64.b64encode(b"admin:wrong").decode("utf-8")
        request = _make_request(
            headers={"Authorization": f"Basic {credentials}"},
            config_store=store,
        )

        with pytest.raises(HTTPException) as exc_info:
            await admin_auth_dependency(request)
        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_invalid_basic_auth_encoding(self):
        """Malformed Basic auth encoding should raise 401."""
        from app.middleware.auth import admin_auth_dependency

        request = _make_request(
            headers={"Authorization": "Basic not-valid-base64!!!"},
        )

        with pytest.raises(HTTPException) as exc_info:
            await admin_auth_dependency(request)
        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_invalid_auth_header_format(self):
        """Unrecognized auth scheme should raise 401."""
        from app.middleware.auth import admin_auth_dependency

        request = _make_request(
            headers={"Authorization": "Digest something"},
        )

        with pytest.raises(HTTPException) as exc_info:
            await admin_auth_dependency(request)
        assert exc_info.value.status_code == 401
        assert "Invalid Authorization header format" in exc_info.value.detail["error"]["message"]
