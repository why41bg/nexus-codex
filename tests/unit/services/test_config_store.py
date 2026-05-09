"""Unit tests for config_store — API key CRUD, model management, admin auth."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import pytest

from app.models import ApiKeyEntry, AppConfig, BannedIP


# ═══════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════


@pytest.fixture(autouse=True)
def reset_config_global():
    """Reset the module-level _config global before each test."""
    import app.services.config_store as cs

    cs._config = None
    cs._api_key_set_cache = None
    yield
    cs._config = None
    cs._api_key_set_cache = None


@pytest.fixture
def seeded_config():
    """Set up a config with known API keys and models."""
    import app.services.config_store as cs

    cs._config = AppConfig(
        default_models=["gpt-5.5", "gpt-5.4"],
        api_keys=[
            ApiKeyEntry(
                key="sk-key-1",
                name="Key One",
                models=["gpt-5.5"],
                created_at="2024-01-01T00:00:00Z",
                monthly_quota=1000,
                monthly_usage=0,
                monthly_reset_at="2025-01-01T00:00:00Z",
            ),
            ApiKeyEntry(
                key="sk-key-2",
                name="Key Two",
                models=[],
                created_at="2024-02-01T00:00:00Z",
            ),
        ],
    )
    cs._api_key_set_cache = None
    return cs


# ═══════════════════════════════════════════════════════════════
# get_api_key_set
# ═══════════════════════════════════════════════════════════════


class TestGetApiKeySet:
    def test_returns_all_keys(self, seeded_config):
        from app.services.config_store import get_api_key_set

        keys = get_api_key_set()
        assert keys == {"sk-key-1", "sk-key-2"}

    def test_empty_when_no_config(self):
        from app.services.config_store import get_api_key_set

        assert get_api_key_set() == set()

    def test_cache_is_used(self, seeded_config):
        from app.services.config_store import get_api_key_set

        keys1 = get_api_key_set()
        keys2 = get_api_key_set()
        assert keys1 is keys2  # same object from cache


# ═══════════════════════════════════════════════════════════════
# get_default_models
# ═══════════════════════════════════════════════════════════════


class TestGetDefaultModels:
    def test_returns_models(self, seeded_config):
        from app.services.config_store import get_default_models

        assert get_default_models() == ["gpt-5.5", "gpt-5.4"]

    def test_empty_when_no_config(self):
        from app.services.config_store import get_default_models

        assert get_default_models() == []


# ═══════════════════════════════════════════════════════════════
# find_api_key
# ═══════════════════════════════════════════════════════════════


class TestFindApiKey:
    def test_find_existing_key(self, seeded_config):
        from app.services.config_store import find_api_key

        entry = find_api_key("sk-key-1")
        assert entry is not None
        assert entry.name == "Key One"

    def test_find_nonexistent_key(self, seeded_config):
        from app.services.config_store import find_api_key

        assert find_api_key("sk-nonexistent") is None

    def test_none_when_no_config(self):
        from app.services.config_store import find_api_key

        assert find_api_key("sk-any") is None


# ═══════════════════════════════════════════════════════════════
# get_models_for_key / is_model_allowed_for_key
# ═══════════════════════════════════════════════════════════════


class TestModelAccess:
    def test_key_specific_models(self, seeded_config):
        from app.services.config_store import get_models_for_key

        assert get_models_for_key("sk-key-1") == ["gpt-5.5"]

    def test_fallback_to_default_models(self, seeded_config):
        from app.services.config_store import get_models_for_key

        # sk-key-2 has no specific models, should fall back to defaults
        assert get_models_for_key("sk-key-2") == ["gpt-5.5", "gpt-5.4"]

    def test_unknown_key_returns_empty(self, seeded_config):
        from app.services.config_store import get_models_for_key

        assert get_models_for_key("sk-unknown") == []

    def test_is_model_allowed(self, seeded_config):
        from app.services.config_store import is_model_allowed_for_key

        assert is_model_allowed_for_key("sk-key-1", "gpt-5.5") is True
        assert is_model_allowed_for_key("sk-key-1", "gpt-5.4") is False

    def test_is_model_allowed_fallback(self, seeded_config):
        from app.services.config_store import is_model_allowed_for_key

        # sk-key-2 falls back to defaults which include gpt-5.5
        assert is_model_allowed_for_key("sk-key-2", "gpt-5.5") is True


# ═══════════════════════════════════════════════════════════════
# verify_admin_auth / verify_admin_password
# ═══════════════════════════════════════════════════════════════


class TestAdminAuth:
    def test_verify_admin_auth_correct(self):
        from app.services.config_store import verify_admin_auth

        with patch("app.services.config_store.settings") as mock_settings:
            mock_settings.admin_username = "admin"
            mock_settings.admin_password = "secret"
            assert verify_admin_auth("admin", "secret") is True

    def test_verify_admin_auth_wrong_password(self):
        from app.services.config_store import verify_admin_auth

        with patch("app.services.config_store.settings") as mock_settings:
            mock_settings.admin_username = "admin"
            mock_settings.admin_password = "secret"
            assert verify_admin_auth("admin", "wrong") is False

    def test_verify_admin_auth_wrong_username(self):
        from app.services.config_store import verify_admin_auth

        with patch("app.services.config_store.settings") as mock_settings:
            mock_settings.admin_username = "admin"
            mock_settings.admin_password = "secret"
            assert verify_admin_auth("hacker", "secret") is False

    def test_verify_admin_password(self):
        from app.services.config_store import verify_admin_password

        with patch("app.services.config_store.settings") as mock_settings:
            mock_settings.admin_password = "secret"
            assert verify_admin_password("secret") is True
            assert verify_admin_password("wrong") is False


# ═══════════════════════════════════════════════════════════════
# API Key CRUD
# ═══════════════════════════════════════════════════════════════


class TestApiKeyCRUD:
    @pytest.mark.asyncio
    async def test_add_api_key(self, seeded_config):
        from app.services.config_store import add_api_key, find_api_key

        with patch("app.services.config_store._save_config") as mock_save:
            entry = await add_api_key("sk-new", "New Key", models=["gpt-5.5"])

        assert entry.key == "sk-new"
        assert entry.name == "New Key"
        assert entry.models == ["gpt-5.5"]
        assert entry.monthly_usage == 0
        assert entry.monthly_reset_at is not None
        mock_save.assert_called_once()

    @pytest.mark.asyncio
    async def test_add_api_key_no_config_raises(self):
        from app.services.config_store import add_api_key

        with pytest.raises(RuntimeError, match="Config not loaded"):
            await add_api_key("sk-new", "New Key")

    @pytest.mark.asyncio
    async def test_update_api_key(self, seeded_config):
        from app.services.config_store import update_api_key, find_api_key

        with patch("app.services.config_store._save_config"):
            entry = await update_api_key("sk-key-1", name="Updated Name", monthly_quota=500)

        assert entry is not None
        assert entry.name == "Updated Name"
        assert entry.monthly_quota == 500

    @pytest.mark.asyncio
    async def test_update_nonexistent_key(self, seeded_config):
        from app.services.config_store import update_api_key

        with patch("app.services.config_store._save_config"):
            result = await update_api_key("sk-nonexistent", name="X")
        assert result is None

    @pytest.mark.asyncio
    async def test_remove_api_key(self, seeded_config):
        from app.services.config_store import remove_api_key, get_api_key_set

        with patch("app.services.config_store._save_config"):
            result = await remove_api_key("sk-key-1")

        assert result is True
        assert get_api_key_set() == {"sk-key-2"}

    @pytest.mark.asyncio
    async def test_remove_nonexistent_key(self, seeded_config):
        from app.services.config_store import remove_api_key

        with patch("app.services.config_store._save_config"):
            result = await remove_api_key("sk-nonexistent")
        assert result is False


# ═══════════════════════════════════════════════════════════════
# Default Models CRUD
# ═══════════════════════════════════════════════════════════════


class TestDefaultModelsCRUD:
    @pytest.mark.asyncio
    async def test_add_default_model(self, seeded_config):
        from app.services.config_store import add_default_model, get_default_models

        with patch("app.services.config_store._save_config"):
            result = await add_default_model("gpt-5.6")

        assert result is True
        assert "gpt-5.6" in get_default_models()

    @pytest.mark.asyncio
    async def test_add_duplicate_model(self, seeded_config):
        from app.services.config_store import add_default_model

        with patch("app.services.config_store._save_config"):
            result = await add_default_model("gpt-5.5")
        assert result is False

    @pytest.mark.asyncio
    async def test_remove_default_model(self, seeded_config):
        from app.services.config_store import remove_default_model, get_default_models

        with patch("app.services.config_store._save_config"):
            result = await remove_default_model("gpt-5.5")

        assert result is True
        assert "gpt-5.5" not in get_default_models()

    @pytest.mark.asyncio
    async def test_remove_nonexistent_model(self, seeded_config):
        from app.services.config_store import remove_default_model

        with patch("app.services.config_store._save_config"):
            result = await remove_default_model("gpt-99")
        assert result is False


# ═══════════════════════════════════════════════════════════════
# Monthly quota
# ═══════════════════════════════════════════════════════════════


class TestMonthlyQuota:
    @pytest.mark.asyncio
    async def test_increment_monthly_usage(self, seeded_config):
        from app.services.config_store import increment_key_monthly_usage, find_api_key

        with patch("app.services.config_store._save_config"):
            await increment_key_monthly_usage("sk-key-1")

        entry = find_api_key("sk-key-1")
        assert entry.monthly_usage == 1

    @pytest.mark.asyncio
    async def test_increment_unknown_key_noop(self, seeded_config):
        from app.services.config_store import increment_key_monthly_usage

        with patch("app.services.config_store._save_config") as mock_save:
            await increment_key_monthly_usage("sk-unknown")
        mock_save.assert_not_called()

    @pytest.mark.asyncio
    async def test_quota_reset_on_new_month(self, seeded_config):
        from app.services.config_store import increment_key_monthly_usage, find_api_key

        # Set reset_at to a past date to trigger reset
        entry = find_api_key("sk-key-1")
        entry.monthly_usage = 500
        entry.monthly_reset_at = "2020-01-01T00:00:00Z"

        with patch("app.services.config_store._save_config"):
            await increment_key_monthly_usage("sk-key-1")

        assert entry.monthly_usage == 1  # reset to 0 then incremented


# ═══════════════════════════════════════════════════════════════
# Banned IPs
# ═══════════════════════════════════════════════════════════════


class TestBannedIPs:
    def test_get_banned_ips_from_config(self, seeded_config):
        from app.services.config_store import get_banned_ips_from_config

        ips = get_banned_ips_from_config()
        assert ips == []

    def test_get_banned_ips_no_config(self):
        from app.services.config_store import get_banned_ips_from_config

        assert get_banned_ips_from_config() == []

    @pytest.mark.asyncio
    async def test_save_banned_ips(self, seeded_config):
        from app.services.config_store import save_banned_ips, get_banned_ips_from_config

        banned = [BannedIP(ip="10.0.0.1", reason="test")]
        with patch("app.services.config_store._save_config"):
            await save_banned_ips(banned)

        result = get_banned_ips_from_config()
        assert len(result) == 1
        assert result[0].ip == "10.0.0.1"

    @pytest.mark.asyncio
    async def test_save_banned_ips_no_config(self):
        from app.services.config_store import save_banned_ips

        # Should not raise
        await save_banned_ips([BannedIP(ip="10.0.0.1")])
