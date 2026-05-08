"""Unit tests for AccountStore — account persistence and CRUD operations."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest


@pytest.fixture(autouse=True)
def reset_account_cache():
    import app.services.account_store as store

    store._accounts_cache = None
    yield
    store._accounts_cache = None


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
    async def test_load_from_file(self, tmp_path, accounts_json_content):
        from app.services.account_store import load_accounts

        data_file = tmp_path / "accounts.json"
        data_file.write_text(json.dumps(accounts_json_content))

        with patch("app.services.account_store.DATA_PATH", data_file):
            accounts = await load_accounts()
            assert len(accounts) == 2
            assert accounts[0].id == "acc-1"
            assert accounts[0].codex_home == "/tmp/acc1"

    @pytest.mark.asyncio
    async def test_missing_file_returns_empty(self, tmp_path):
        from app.services.account_store import load_accounts

        data_file = tmp_path / "nonexistent.json"
        with patch("app.services.account_store.DATA_PATH", data_file):
            accounts = await load_accounts()
            assert accounts == []

    @pytest.mark.asyncio
    async def test_non_array_data_returns_empty(self, tmp_path):
        from app.services.account_store import load_accounts

        data_file = tmp_path / "accounts.json"
        data_file.write_text('{"not": "array"}')

        with patch("app.services.account_store.DATA_PATH", data_file):
            accounts = await load_accounts()
            assert accounts == []

    @pytest.mark.asyncio
    async def test_corrupt_file_returns_empty(self, tmp_path):
        from app.services.account_store import load_accounts

        data_file = tmp_path / "accounts.json"
        data_file.write_text("not json")

        with patch("app.services.account_store.DATA_PATH", data_file):
            accounts = await load_accounts()
            assert accounts == []

    @pytest.mark.asyncio
    async def test_cache_returns_copies(self, tmp_path, accounts_json_content):
        from app.services.account_store import load_accounts

        data_file = tmp_path / "accounts.json"
        data_file.write_text(json.dumps(accounts_json_content))

        with patch("app.services.account_store.DATA_PATH", data_file):
            a1 = await load_accounts()
            a2 = await load_accounts()
            assert a1[0] is not a2[0]  # different objects (model_copy)


class TestAddAccount:
    @pytest.mark.asyncio
    async def test_add_account(self, tmp_path):
        from app.services.account_store import add_account, load_accounts

        data_file = tmp_path / "accounts.json"
        data_file.write_text("[]")

        with patch("app.services.account_store.DATA_PATH", data_file):
            with patch("app.services.account_store.DATA_DIR", tmp_path):
                acc = await add_account("/tmp/new-acc", remark="New", max_concurrency=5)

        assert acc.codex_home == "/tmp/new-acc"
        assert acc.remark == "New"
        assert acc.max_concurrency == 5
        assert acc.enabled is True
        assert acc.healthy is True
        assert acc.id.startswith("acc-")


class TestUpdateAccount:
    @pytest.mark.asyncio
    async def test_update_existing(self, tmp_path, accounts_json_content):
        from app.services.account_store import update_account, load_accounts

        data_file = tmp_path / "accounts.json"
        data_file.write_text(json.dumps(accounts_json_content))

        with patch("app.services.account_store.DATA_PATH", data_file):
            with patch("app.services.account_store.DATA_DIR", tmp_path):
                acc = await update_account("acc-1", remark="Updated", enabled=False)

        assert acc is not None
        assert acc.remark == "Updated"
        assert acc.enabled is False

    @pytest.mark.asyncio
    async def test_update_nonexistent(self, tmp_path, accounts_json_content):
        from app.services.account_store import update_account

        data_file = tmp_path / "accounts.json"
        data_file.write_text(json.dumps(accounts_json_content))

        with patch("app.services.account_store.DATA_PATH", data_file):
            with patch("app.services.account_store.DATA_DIR", tmp_path):
                result = await update_account("nonexistent", remark="X")
        assert result is None


class TestIncrementUsageCount:
    @pytest.mark.asyncio
    async def test_increment(self, tmp_path, accounts_json_content):
        from app.services.account_store import increment_usage_count, load_accounts

        data_file = tmp_path / "accounts.json"
        data_file.write_text(json.dumps(accounts_json_content))

        with patch("app.services.account_store.DATA_PATH", data_file):
            with patch("app.services.account_store.DATA_DIR", tmp_path):
                await increment_usage_count("acc-1")
                accounts = await load_accounts()
                acc = next(a for a in accounts if a.id == "acc-1")
                assert acc.usage_count == 11
                assert acc.last_used_at is not None

    @pytest.mark.asyncio
    async def test_increment_unknown_noop(self, tmp_path, accounts_json_content):
        from app.services.account_store import increment_usage_count

        data_file = tmp_path / "accounts.json"
        data_file.write_text(json.dumps(accounts_json_content))

        with patch("app.services.account_store.DATA_PATH", data_file):
            with patch("app.services.account_store.DATA_DIR", tmp_path):
                # Should not raise
                await increment_usage_count("nonexistent")


class TestRemoveAccount:
    @pytest.mark.asyncio
    async def test_remove_existing(self, tmp_path, accounts_json_content):
        from app.services.account_store import remove_account, load_accounts

        data_file = tmp_path / "accounts.json"
        data_file.write_text(json.dumps(accounts_json_content))

        with patch("app.services.account_store.DATA_PATH", data_file):
            with patch("app.services.account_store.DATA_DIR", tmp_path):
                result = await remove_account("acc-1")
                assert result is True
                accounts = await load_accounts()
                assert len(accounts) == 1

    @pytest.mark.asyncio
    async def test_remove_nonexistent(self, tmp_path, accounts_json_content):
        from app.services.account_store import remove_account

        data_file = tmp_path / "accounts.json"
        data_file.write_text(json.dumps(accounts_json_content))

        with patch("app.services.account_store.DATA_PATH", data_file):
            with patch("app.services.account_store.DATA_DIR", tmp_path):
                result = await remove_account("nonexistent")
        assert result is False


class TestBulkImport:
    @pytest.mark.asyncio
    async def test_merge_mode(self, tmp_path, accounts_json_content):
        from app.services.account_store import bulk_import_accounts, load_accounts

        data_file = tmp_path / "accounts.json"
        data_file.write_text(json.dumps(accounts_json_content))

        items = [
            {"codex_home": "/tmp/acc3", "remark": "New"},
            {"codex_home": "/tmp/acc1", "remark": "Duplicate"},  # already exists
        ]

        with patch("app.services.account_store.DATA_PATH", data_file):
            with patch("app.services.account_store.DATA_DIR", tmp_path):
                result = await bulk_import_accounts(items, mode="merge")

        assert result["imported"] == 1
        assert result["skipped"] == 1

    @pytest.mark.asyncio
    async def test_replace_mode(self, tmp_path, accounts_json_content):
        from app.services.account_store import bulk_import_accounts, load_accounts

        data_file = tmp_path / "accounts.json"
        data_file.write_text(json.dumps(accounts_json_content))

        items = [
            {"codex_home": "/tmp/acc3", "remark": "Replacement"},
        ]

        with patch("app.services.account_store.DATA_PATH", data_file):
            with patch("app.services.account_store.DATA_DIR", tmp_path):
                result = await bulk_import_accounts(items, mode="replace")

        assert result["imported"] == 1
        accounts = await load_accounts()
        assert len(accounts) == 1

    @pytest.mark.asyncio
    async def test_missing_codex_home(self, tmp_path):
        from app.services.account_store import bulk_import_accounts

        data_file = tmp_path / "accounts.json"
        data_file.write_text("[]")

        items = [{"remark": "No home"}]

        with patch("app.services.account_store.DATA_PATH", data_file):
            with patch("app.services.account_store.DATA_DIR", tmp_path):
                result = await bulk_import_accounts(items)

        assert result["imported"] == 0
        assert len(result["errors"]) == 1
