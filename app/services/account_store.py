from __future__ import annotations

"""Account persistence store - manages data/accounts.json.

All mutable state is encapsulated in the AccountStore class.
An instance is created during app startup and stored in AppDependencies.
"""

import asyncio
import json
import os
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import aiofiles

from app.models import Account
from app.utils.logger import log

DATA_DIR = Path(__file__).parent.parent.parent / "data"
DATA_PATH = DATA_DIR / "accounts.json"


class AccountStore:
    """Encapsulated account persistence — no module-level globals.

    All mutable state (cache, write lock, pending increments) is
    instance-level, making the store testable and safe in multi-instance
    scenarios.
    """

    FLUSH_INTERVAL_SEC: float = 30.0

    def __init__(self) -> None:
        self._accounts_cache: list[Account] | None = None
        self._write_lock = asyncio.Lock()
        self._pending_increments: dict[str, int] = {}
        self._pending_last_used: dict[str, str] = {}
        self._last_flush_time: float = 0.0

    # ─── Core CRUD ──────────────────────────────────────────────

    async def load_accounts(self) -> list[Account]:
        """Load accounts from disk (with in-memory cache)."""
        if self._accounts_cache is not None:
            return [a.model_copy() for a in self._accounts_cache]

        exists = await asyncio.to_thread(DATA_PATH.exists)
        if not exists:
            return []

        try:
            async with aiofiles.open(DATA_PATH, mode="r", encoding="utf-8") as f:
                raw = await f.read()
            parsed = json.loads(raw)
            if not isinstance(parsed, list):
                log.warn("accounts.json contains non-array data, resetting to empty")
                return []
            self._accounts_cache = [Account(**item) for item in parsed]
            return [a.model_copy() for a in self._accounts_cache]
        except Exception as e:
            log.error("Failed to load accounts.json", extra={"error": str(e)})
            return []

    async def _save_accounts(self, accounts: list[Account]) -> None:
        """Atomically save accounts to disk."""
        async with self._write_lock:
            await asyncio.to_thread(DATA_DIR.mkdir, parents=True, exist_ok=True)
            tmp_path = DATA_PATH.with_suffix(".tmp")
            data = json.dumps(
                [a.model_dump(exclude_none=True) for a in accounts], indent=2
            )
            async with aiofiles.open(tmp_path, mode="w", encoding="utf-8") as f:
                await f.write(data + "\n")
            await asyncio.to_thread(os.replace, str(tmp_path), str(DATA_PATH))
            self._accounts_cache = [a.model_copy() for a in accounts]

    async def add_account(
        self, codex_home: str, remark: str = "", max_concurrency: int | None = None
    ) -> Account:
        """Add a new account."""
        accounts = await self.load_accounts()
        new_account = Account(
            id=f"acc-{uuid.uuid4().hex[:12]}",
            codex_home=codex_home,
            enabled=True,
            healthy=True,
            remark=remark,
            usage_count=0,
            last_used_at=None,
            max_concurrency=max_concurrency,
        )
        accounts.append(new_account)
        await self._save_accounts(accounts)
        return new_account

    async def update_account(
        self, account_id: str, **updates: object
    ) -> Account | None:
        """Update an existing account.

        Callers are expected to pass only the fields they want to change
        (e.g. via ``model_dump(exclude_unset=True)``).  Values of ``None``
        are applied as-is, allowing explicit clearing of optional fields.
        The ``id`` field is always preserved to prevent accidental ID changes.
        """
        updates.pop("id", None)  # Never allow ID mutation
        accounts = await self.load_accounts()
        for i, acc in enumerate(accounts):
            if acc.id == account_id:
                data = acc.model_dump()
                data.update(updates)
                accounts[i] = Account(**data)
                await self._save_accounts(accounts)
                return accounts[i]
        return None

    async def remove_account(self, account_id: str) -> bool:
        """Remove an account by ID."""
        accounts = await self.load_accounts()
        original_len = len(accounts)
        accounts = [a for a in accounts if a.id != account_id]
        if len(accounts) == original_len:
            return False
        await self._save_accounts(accounts)
        return True

    # ─── Write-behind usage counter ─────────────────────────────

    async def increment_usage_count(self, account_id: str) -> None:
        """Increment the usage count for an account.

        The increment is accumulated in memory and flushed to disk
        periodically (every ``FLUSH_INTERVAL_SEC`` seconds) to avoid a
        full accounts.json read → modify → write cycle on every request.
        """
        self._pending_increments[account_id] = self._pending_increments.get(account_id, 0) + 1
        self._pending_last_used[account_id] = datetime.now(timezone.utc).isoformat()

        # Flush to disk if enough time has elapsed
        now = time.monotonic()
        if now - self._last_flush_time >= self.FLUSH_INTERVAL_SEC:
            await self.flush_usage_counters()

    async def flush_usage_counters(self) -> None:
        """Flush all pending usage increments to disk.

        Safe to call at any time.  If there are no pending increments the
        function returns immediately.
        """
        if not self._pending_increments:
            self._last_flush_time = time.monotonic()
            return

        # Snapshot and clear pending state atomically
        increments = dict(self._pending_increments)
        last_used = dict(self._pending_last_used)
        self._pending_increments.clear()
        self._pending_last_used.clear()
        self._last_flush_time = time.monotonic()

        accounts = await self.load_accounts()
        changed = False
        for acc in accounts:
            delta = increments.get(acc.id)
            if delta:
                acc.usage_count += delta
                acc.last_used_at = last_used.get(acc.id, acc.last_used_at)
                changed = True
        if changed:
            await self._save_accounts(accounts)

    # ─── Bulk operations ────────────────────────────────────────

    async def bulk_import_accounts(
        self, items: list[dict], mode: str = "merge"
    ) -> dict:
        """Bulk import accounts."""
        result = {"imported": 0, "skipped": 0, "errors": [], "imported_accounts": []}

        if mode == "replace":
            new_accounts: list[Account] = []
            for i, item in enumerate(items):
                codex_home = item.get("codex_home", "").strip()
                if not codex_home:
                    result["errors"].append({"index": i, "message": "codex_home is required"})
                    continue
                acc = Account(
                    id=f"acc-{uuid.uuid4().hex[:12]}",
                    codex_home=codex_home,
                    enabled=item.get("enabled", True),
                    healthy=True,
                    remark=(item.get("remark") or "").strip(),
                    usage_count=0,
                    last_used_at=None,
                    max_concurrency=item.get("max_concurrency"),
                )
                new_accounts.append(acc)
                result["imported_accounts"].append(acc.model_dump())
                result["imported"] += 1
            await self._save_accounts(new_accounts)
        else:
            accounts = await self.load_accounts()
            existing_homes = {a.codex_home for a in accounts}
            for i, item in enumerate(items):
                codex_home = item.get("codex_home", "").strip()
                if not codex_home:
                    result["errors"].append({"index": i, "message": "codex_home is required"})
                    continue
                if codex_home in existing_homes:
                    result["skipped"] += 1
                    continue
                acc = Account(
                    id=f"acc-{uuid.uuid4().hex[:12]}",
                    codex_home=codex_home,
                    enabled=item.get("enabled", True),
                    healthy=True,
                    remark=(item.get("remark") or "").strip(),
                    usage_count=0,
                    last_used_at=None,
                    max_concurrency=item.get("max_concurrency"),
                )
                accounts.append(acc)
                existing_homes.add(codex_home)
                result["imported_accounts"].append(acc.model_dump())
                result["imported"] += 1
            await self._save_accounts(accounts)

        return result
