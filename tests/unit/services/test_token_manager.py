"""Unit tests for TokenManager — OAuth token lifecycle management."""

from __future__ import annotations

import json
import time
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.token_manager import TokenManager, parse_jwt_expiry


# ═══════════════════════════════════════════════════════════════
# parse_jwt_expiry
# ═══════════════════════════════════════════════════════════════


class TestParseJwtExpiry:
    def test_valid_jwt(self):
        """Valid JWT should return exp claim."""
        # Create a minimal JWT with exp=1700000000
        import base64
        header = base64.urlsafe_b64encode(json.dumps({"alg": "HS256"}).encode()).rstrip(b"=").decode()
        payload = base64.urlsafe_b64encode(json.dumps({"exp": 1700000000}).encode()).rstrip(b"=").decode()
        token = f"{header}.{payload}.sig"
        assert parse_jwt_expiry(token) == 1700000000

    def test_invalid_jwt_parts(self):
        """JWT with wrong number of parts returns None."""
        assert parse_jwt_expiry("only.two") is None

    def test_invalid_base64(self):
        """Invalid base64 returns None."""
        assert parse_jwt_expiry("a.!!!.c") is None

    def test_no_exp_claim(self):
        """JWT without exp claim returns None."""
        import base64
        header = base64.urlsafe_b64encode(json.dumps({"alg": "HS256"}).encode()).rstrip(b"=").decode()
        payload = base64.urlsafe_b64encode(json.dumps({"sub": "user"}).encode()).rstrip(b"=").decode()
        token = f"{header}.{payload}.sig"
        assert parse_jwt_expiry(token) is None


# ═══════════════════════════════════════════════════════════════
# TokenManager
# ═══════════════════════════════════════════════════════════════


@pytest.fixture
def auth_json_content():
    """Sample auth.json content."""
    import base64
    header = base64.urlsafe_b64encode(json.dumps({"alg": "HS256"}).encode()).rstrip(b"=").decode()
    payload = base64.urlsafe_b64encode(json.dumps({"exp": int(time.time()) + 3600}).encode()).rstrip(b"=").decode()
    access_token = f"{header}.{payload}.sig"

    return {
        "plan_type": "plus",
        "tokens": {
            "access_token": access_token,
            "refresh_token": "rt-abc123",
            "account_id": "acc-test-001",
        },
    }


@pytest.fixture
def expired_auth_json():
    """auth.json with expired token."""
    import base64
    header = base64.urlsafe_b64encode(json.dumps({"alg": "HS256"}).encode()).rstrip(b"=").decode()
    payload = base64.urlsafe_b64encode(json.dumps({"exp": int(time.time()) - 3600}).encode()).rstrip(b"=").decode()
    access_token = f"{header}.{payload}.sig"

    return {
        "plan_type": "plus",
        "tokens": {
            "access_token": access_token,
            "refresh_token": "rt-abc123",
            "account_id": "acc-test-001",
        },
    }


class TestTokenManagerInit:
    """Tests for TokenManager initialization."""

    def test_loads_auth_json(self, tmp_path, auth_json_content):
        """TokenManager should load tokens from auth.json."""
        codex_home = tmp_path / "codex-home"
        codex_home.mkdir()
        (codex_home / "auth.json").write_text(json.dumps(auth_json_content))

        tm = TokenManager(str(codex_home))
        assert tm._access_token is not None
        assert tm._refresh_token == "rt-abc123"
        assert tm._account_id == "acc-test-001"
        assert tm._plan_type == "plus"

    def test_missing_auth_json(self, tmp_path):
        """Missing auth.json should not raise."""
        codex_home = tmp_path / "codex-home"
        codex_home.mkdir()
        tm = TokenManager(str(codex_home))
        assert tm._access_token is None

    def test_corrupt_auth_json(self, tmp_path):
        """Corrupt auth.json should not raise."""
        codex_home = tmp_path / "codex-home"
        codex_home.mkdir()
        (codex_home / "auth.json").write_text("not json")
        tm = TokenManager(str(codex_home))
        assert tm._access_token is None


class TestTokenManagerPublicAPI:
    """Tests for public TokenManager methods."""

    def test_get_account_id(self, tmp_path, auth_json_content):
        codex_home = tmp_path / "codex-home"
        codex_home.mkdir()
        (codex_home / "auth.json").write_text(json.dumps(auth_json_content))
        tm = TokenManager(str(codex_home))
        assert tm.get_account_id() == "acc-test-001"

    def test_get_plan_type(self, tmp_path, auth_json_content):
        codex_home = tmp_path / "codex-home"
        codex_home.mkdir()
        (codex_home / "auth.json").write_text(json.dumps(auth_json_content))
        tm = TokenManager(str(codex_home))
        assert tm.get_plan_type() == "plus"

    def test_is_refreshable(self, tmp_path, auth_json_content):
        codex_home = tmp_path / "codex-home"
        codex_home.mkdir()
        (codex_home / "auth.json").write_text(json.dumps(auth_json_content))
        tm = TokenManager(str(codex_home))
        assert tm.is_refreshable() is True

    def test_is_not_refreshable_without_token(self, tmp_path):
        codex_home = tmp_path / "codex-home"
        codex_home.mkdir()
        tm = TokenManager(str(codex_home))
        assert tm.is_refreshable() is False

    def test_get_account_info(self, tmp_path, auth_json_content):
        codex_home = tmp_path / "codex-home"
        codex_home.mkdir()
        (codex_home / "auth.json").write_text(json.dumps(auth_json_content))
        tm = TokenManager(str(codex_home))
        info = tm.get_account_info()
        assert info["plan_type"] == "plus"
        assert info["account_id"] == "acc-test-001"
        assert "token_valid" in info

    @pytest.mark.asyncio
    async def test_get_access_token_valid(self, tmp_path, auth_json_content):
        codex_home = tmp_path / "codex-home"
        codex_home.mkdir()
        (codex_home / "auth.json").write_text(json.dumps(auth_json_content))
        tm = TokenManager(str(codex_home))
        token = await tm.get_access_token()
        assert token is not None

    @pytest.mark.asyncio
    async def test_get_access_token_expired_triggers_refresh(self, tmp_path, expired_auth_json):
        codex_home = tmp_path / "codex-home"
        codex_home.mkdir()
        (codex_home / "auth.json").write_text(json.dumps(expired_auth_json))
        tm = TokenManager(str(codex_home))

        with patch.object(tm, "_do_refresh", new_callable=AsyncMock) as mock_refresh:
            mock_refresh.return_value = True
            token = await tm.get_access_token()
            mock_refresh.assert_called_once()

    @pytest.mark.asyncio
    async def test_refresh_if_needed_when_valid(self, tmp_path, auth_json_content):
        codex_home = tmp_path / "codex-home"
        codex_home.mkdir()
        (codex_home / "auth.json").write_text(json.dumps(auth_json_content))
        tm = TokenManager(str(codex_home))

        with patch.object(tm, "_do_refresh", new_callable=AsyncMock) as mock_refresh:
            result = await tm.refresh_if_needed()
            assert result is True
            mock_refresh.assert_not_called()

    @pytest.mark.asyncio
    async def test_refresh_if_needed_when_expired(self, tmp_path, expired_auth_json):
        codex_home = tmp_path / "codex-home"
        codex_home.mkdir()
        (codex_home / "auth.json").write_text(json.dumps(expired_auth_json))
        tm = TokenManager(str(codex_home))

        with patch.object(tm, "_do_refresh", new_callable=AsyncMock) as mock_refresh:
            mock_refresh.return_value = True
            result = await tm.refresh_if_needed()
            assert result is True
            mock_refresh.assert_called_once()

    @pytest.mark.asyncio
    async def test_force_refresh(self, tmp_path, auth_json_content):
        codex_home = tmp_path / "codex-home"
        codex_home.mkdir()
        (codex_home / "auth.json").write_text(json.dumps(auth_json_content))
        tm = TokenManager(str(codex_home))

        with patch.object(tm, "_do_refresh", new_callable=AsyncMock) as mock_refresh:
            mock_refresh.return_value = True
            result = await tm.force_refresh()
            assert result is True
            mock_refresh.assert_called_once()


class TestTokenRefresh:
    """Tests for _do_refresh()."""

    @pytest.mark.asyncio
    async def test_do_refresh_success(self, tmp_path, expired_auth_json):
        codex_home = tmp_path / "codex-home"
        codex_home.mkdir()
        (codex_home / "auth.json").write_text(json.dumps(expired_auth_json))
        tm = TokenManager(str(codex_home))

        import base64
        header = base64.urlsafe_b64encode(json.dumps({"alg": "HS256"}).encode()).rstrip(b"=").decode()
        payload = base64.urlsafe_b64encode(json.dumps({"exp": int(time.time()) + 7200}).encode()).rstrip(b"=").decode()
        new_token = f"{header}.{payload}.sig"

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "access_token": new_token,
            "refresh_token": "rt-new",
        }

        with (
            patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post,
            patch.object(tm, "_save_auth_json", new_callable=AsyncMock) as mock_save,
        ):
            mock_post.return_value = mock_response
            result = await tm._do_refresh()
            assert result is True
            mock_save.assert_called_once()

    @pytest.mark.asyncio
    async def test_do_refresh_no_refresh_token(self, tmp_path):
        codex_home = tmp_path / "codex-home"
        codex_home.mkdir()
        tm = TokenManager(str(codex_home))
        result = await tm._do_refresh()
        assert result is False

    @pytest.mark.asyncio
    async def test_do_refresh_http_error(self, tmp_path, expired_auth_json):
        codex_home = tmp_path / "codex-home"
        codex_home.mkdir()
        (codex_home / "auth.json").write_text(json.dumps(expired_auth_json))
        tm = TokenManager(str(codex_home))

        mock_response = MagicMock()
        mock_response.status_code = 400
        mock_response.text = "Bad request"

        with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = mock_response
            result = await tm._do_refresh()
            assert result is False

    @pytest.mark.asyncio
    async def test_do_refresh_network_error(self, tmp_path, expired_auth_json):
        codex_home = tmp_path / "codex-home"
        codex_home.mkdir()
        (codex_home / "auth.json").write_text(json.dumps(expired_auth_json))
        tm = TokenManager(str(codex_home))

        with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
            mock_post.side_effect = Exception("Network error")
            result = await tm._do_refresh()
            assert result is False

    @pytest.mark.asyncio
    async def test_do_refresh_double_check_after_lock(self, tmp_path, auth_json_content):
        """After acquiring lock, if token is already refreshed, skip."""
        codex_home = tmp_path / "codex-home"
        codex_home.mkdir()
        (codex_home / "auth.json").write_text(json.dumps(auth_json_content))
        tm = TokenManager(str(codex_home))

        # Manually set token to be valid so double-check passes
        tm._expires_at = time.time() + 7200

        with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
            result = await tm._do_refresh()
            assert result is True
            mock_post.assert_not_called()
