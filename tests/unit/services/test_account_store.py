"""Unit tests for AccountStore — account persistence and CRUD operations."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest

from app.services.account_store import AccountStore


@pytest.fixture
def store():
    """Create a fresh AccountStore instance for each test."""
    return AccountStore()


@pytest.fixture
def accounts_json_content():
    return [
        {
            "id": "acc-1",
            "codex_home": "/tmp/acc1",
            "enabled": True,
            "healthy": True,
            "remark": "Account 1",
            "usage_count": 10,
            "last_used_at": "2024-01-01T00:00:00Z",
            "max_concurrency": 3,
        },
        {
            "id": "acc-2",
            "codex_home": "/tmp/acc2",
            "enabled": False,
            "healthy": True,
            "remark": "",
            "usage_count": 0,
            "last_used_at": None,
            "max_concurrency": None,
        },
    ]


class TestLoadAccounts:
    @pytest.mark.asyncio
    async def test_load_from_file(self, store, tmp_path, accounts_json_content):
        data_file = tmp_path / "accounts.json"
        data_file.write_text(json.dumps(accounts_json_content))

        with patch("app.services.account_store.DATA_PATH", data_file):
            accounts = await store.load_accounts()
            assert len(accounts) == 2
            assert accounts[0].id == "acc-1"
            assert accounts[0].codex_home == "/tmp/acc1"

    @pytest.mark.asyncio
    async def test_missing_file_returns_empty(self, store, tmp_path):
        data_file = tmp_path / "nonexistent.json"
        with patch("app.services.account_store.DATA_PATH", data_file):
            accounts = await store.load_accounts()
            assert accounts == []

    @pytest.mark.asyncio
    async def test_non_array_data_returns_empty(self, store, tmp_path):
        data_file = tmp_path / "accounts.json"
        data_file.write_text('{"not": "array"}')

        with patch("app.services.account_store.DATA_PATH", data_file):
            accounts = await store.load_accounts()
            assert accounts == []

    @pytest.mark.asyncio
    async def test_corrupt_file_returns_empty(self, store, tmp_path):
        data_file = tmp_path / "accounts.json"
        data_file.write_text("not json")

        with patch("app.services.account_store.DATA_PATH", data_file):
            accounts = await store.load_accounts()
            assert accounts == []

    @pytest.mark.asyncio
    async def test_cache_returns_copies(self, store, tmp_path, accounts_json_content):
        data_file = tmp_path / "accounts.json"
        data_file.write_text(json.dumps(accounts_json_content))

        with patch("app.services.account_store.DATA_PATH", data_file):
            a1 = await store.load_accounts()
            a2 = await store.load_accounts()
            assert a1[0] is not a2[0]  # different objects (model_copy)


class TestAddAccount:
    @pytest.mark.asyncio
    async def test_add_account(self, store, tmp_path):
        data_file = tmp_path / "accounts.json"
        data_file.write_text("[]")

        with patch("app.services.account_store.DATA_PATH", data_file):
            with patch("app.services.account_store.DATA_DIR", tmp_path):
                acc = await store.add_account("/tmp/new-acc", remark="New", max_concurrency=5)

        assert acc.codex_home == "/tmp/new-acc"
        assert acc.remark == "New"
        assert acc.max_concurrency == 5
        assert acc.enabled is True
        assert acc.healthy is True
        assert acc.id.startswith("acc-")


class TestUpdateAccount:
    @pytest.mark.asyncio
    async def test_update_existing(self, store, tmp_path, accounts_json_content):
        data_file = tmp_path / "accounts.json"
        data_file.write_text(json.dumps(accounts_json_content))

        with patch("app.services.account_store.DATA_PATH", data_file):
            with patch("app.services.account_store.DATA_DIR", tmp_path):
                acc = await store.update_account("acc-1", remark="Updated", enabled=False)

        assert acc is not None
        assert acc.remark == "Updated"
        assert acc.enabled is False

    @pytest.mark.asyncio
    async def test_update_nonexistent(self, store, tmp_path, accounts_json_content):
        data_file = tmp_path / "accounts.json"
        data_file.write_text(json.dumps(accounts_json_content))

        with patch("app.services.account_store.DATA_PATH", data_file):
            with patch("app.services.account_store.DATA_DIR", tmp_path):
                result = await store.update_account("nonexistent", remark="X")
        assert result is None


class TestIncrementUsageCount:
    @pytest.mark.asyncio
    async def test_increment(self, store, tmp_path, accounts_json_content):
        data_file = tmp_path / "accounts.json"
        data_file.write_text(json.dumps(accounts_json_content))

        # Set flush interval to 0 so that increment flushes immediately
        store.FLUSH_INTERVAL_SEC = 0.0

        with patch("app.services.account_store.DATA_PATH", data_file):
            with patch("app.services.account_store.DATA_DIR", tmp_path):
                await store.increment_usage_count("acc-1")
                accounts = await store.load_accounts()
                acc = next(a for a in accounts if a.id == "acc-1")
                assert acc.usage_count == 11
                assert acc.last_used_at is not None

    @pytest.mark.asyncio
    async def test_increment_unknown_noop(self, store, tmp_path, accounts_json_content):
        data_file = tmp_path / "accounts.json"
        data_file.write_text(json.dumps(accounts_json_content))

        store.FLUSH_INTERVAL_SEC = 0.0

        with patch("app.services.account_store.DATA_PATH", data_file):
            with patch("app.services.account_store.DATA_DIR", tmp_path):
                # Should not raise
                await store.increment_usage_count("nonexistent")


class TestRemoveAccount:
    @pytest.mark.asyncio
    async def test_remove_existing(self, store, tmp_path, accounts_json_content):
        data_file = tmp_path / "accounts.json"
        data_file.write_text(json.dumps(accounts_json_content))

        with patch("app.services.account_store.DATA_PATH", data_file):
            with patch("app.services.account_store.DATA_DIR", tmp_path):
                result = await store.remove_account("acc-1")
                assert result is True
                accounts = await store.load_accounts()
                assert len(accounts) == 1

    @pytest.mark.asyncio
    async def test_remove_nonexistent(self, store, tmp_path, accounts_json_content):
        data_file = tmp_path / "accounts.json"
        data_file.write_text(json.dumps(accounts_json_content))

        with patch("app.services.account_store.DATA_PATH", data_file):
            with patch("app.services.account_store.DATA_DIR", tmp_path):
                result = await store.remove_account("nonexistent")
        assert result is False


class TestBulkImport:
    @pytest.mark.asyncio
    async def test_merge_mode(self, store, tmp_path, accounts_json_content):
        data_file = tmp_path / "accounts.json"
        data_file.write_text(json.dumps(accounts_json_content))

        items = [
            {"codex_home": "/tmp/acc3", "remark": "New"},
            {"codex_home": "/tmp/acc1", "remark": "Duplicate"},  # already exists
        ]

        with patch("app.services.account_store.DATA_PATH", data_file):
            with patch("app.services.account_store.DATA_DIR", tmp_path):
                result = await store.bulk_import_accounts(items, mode="merge")

        assert result["imported"] == 1
        assert result["skipped"] == 1

    @pytest.mark.asyncio
    async def test_replace_mode(self, store, tmp_path, accounts_json_content):
        data_file = tmp_path / "accounts.json"
        data_file.write_text(json.dumps(accounts_json_content))

        items = [
            {"codex_home": "/tmp/acc3", "remark": "Replacement"},
        ]

        with patch("app.services.account_store.DATA_PATH", data_file):
            with patch("app.services.account_store.DATA_DIR", tmp_path):
                result = await store.bulk_import_accounts(items, mode="replace")

        assert result["imported"] == 1
        accounts = await store.load_accounts()
        assert len(accounts) == 1

    @pytest.mark.asyncio
    async def test_missing_codex_home(self, store, tmp_path):
        data_file = tmp_path / "accounts.json"
        data_file.write_text("[]")

        items = [{"remark": "No home"}]

        with patch("app.services.account_store.DATA_PATH", data_file):
            with patch("app.services.account_store.DATA_DIR", tmp_path):
                result = await store.bulk_import_accounts(items)

        assert result["imported"] == 0
        assert len(result["errors"]) == 1
