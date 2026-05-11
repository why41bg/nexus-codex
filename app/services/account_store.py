from __future__ import annotations

"""Account persistence store - manages data/accounts.json."""

import asyncio
import json
import os
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from app.models import Account
from app.utils.logger import log

DATA_DIR = Path(__file__).parent.parent.parent / "data"
DATA_PATH = DATA_DIR / "accounts.json"

_accounts_cache: list[Account] | None = None
_write_lock = asyncio.Lock()

# ─── Write-behind usage counter cache ────────────────────────
# Pending increments are accumulated in memory and flushed to disk
# periodically (every _FLUSH_INTERVAL_SEC) or when an explicit save
# occurs. This avoids a full accounts.json read/write cycle per request.

_FLUSH_INTERVAL_SEC: float = 30.0
_pending_increments: dict[str, int] = {}  # account_id -> delta
_pending_last_used: dict[str, str] = {}   # account_id -> ISO timestamp
_last_flush_time: float = 0.0


async def load_accounts() -> list[Account]:
    """Load accounts from disk (with in-memory cache)."""
    global _accounts_cache
    if _accounts_cache is not None:
        return [a.model_copy() for a in _accounts_cache]

    if not DATA_PATH.exists():
        return []

    try:
        raw = DATA_PATH.read_text(encoding="utf-8")
        parsed = json.loads(raw)
        if not isinstance(parsed, list):
            log.warn("accounts.json contains non-array data, resetting to empty")
            return []
        _accounts_cache = [Account(**item) for item in parsed]
        return [a.model_copy() for a in _accounts_cache]
    except Exception as e:
        log.error("Failed to load accounts.json", extra={"error": str(e)})
        return []


async def _save_accounts(accounts: list[Account]) -> None:
    """Atomically save accounts to disk."""
    global _accounts_cache
    async with _write_lock:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        tmp_path = DATA_PATH.with_suffix(".tmp")
        data = json.dumps(
            [a.model_dump(exclude_none=True) for a in accounts], indent=2
        )
        tmp_path.write_text(data + "\n", encoding="utf-8")
        os.replace(str(tmp_path), str(DATA_PATH))
        _accounts_cache = [a.model_copy() for a in accounts]


async def add_account(
    codex_home: str, remark: str = "", max_concurrency: int | None = None
) -> Account:
    """Add a new account."""
    accounts = await load_accounts()
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
    await _save_accounts(accounts)
    return new_account


async def update_account(
    account_id: str, **updates: object
) -> Account | None:
    """Update an existing account.

    Callers are expected to pass only the fields they want to change
    (e.g. via ``model_dump(exclude_unset=True)``).  Values of ``None``
    are applied as-is, allowing explicit clearing of optional fields.
    The ``id`` field is always preserved to prevent accidental ID changes.
    """
    updates.pop("id", None)  # Never allow ID mutation
    accounts = await load_accounts()
    for i, acc in enumerate(accounts):
        if acc.id == account_id:
            data = acc.model_dump()
            data.update(updates)
            accounts[i] = Account(**data)
            await _save_accounts(accounts)
            return accounts[i]
    return None


async def increment_usage_count(account_id: str) -> None:
    """Increment the usage count for an account.

    The increment is accumulated in memory and flushed to disk
    periodically (every ``_FLUSH_INTERVAL_SEC`` seconds) to avoid a
    full accounts.json read → modify → write cycle on every request.
    """
    global _last_flush_time

    _pending_increments[account_id] = _pending_increments.get(account_id, 0) + 1
    _pending_last_used[account_id] = datetime.now(timezone.utc).isoformat()

    # Flush to disk if enough time has elapsed
    now = time.monotonic()
    if now - _last_flush_time >= _FLUSH_INTERVAL_SEC:
        await flush_usage_counters()


async def flush_usage_counters() -> None:
    """Flush all pending usage increments to disk.

    Safe to call at any time.  If there are no pending increments the
    function returns immediately.
    """
    global _last_flush_time

    if not _pending_increments:
        _last_flush_time = time.monotonic()
        return

    # Snapshot and clear pending state atomically
    increments = dict(_pending_increments)
    last_used = dict(_pending_last_used)
    _pending_increments.clear()
    _pending_last_used.clear()
    _last_flush_time = time.monotonic()

    accounts = await load_accounts()
    changed = False
    for acc in accounts:
        delta = increments.get(acc.id)
        if delta:
            acc.usage_count += delta
            acc.last_used_at = last_used.get(acc.id, acc.last_used_at)
            changed = True
    if changed:
        await _save_accounts(accounts)


async def remove_account(account_id: str) -> bool:
    """Remove an account by ID."""
    accounts = await load_accounts()
    original_len = len(accounts)
    accounts = [a for a in accounts if a.id != account_id]
    if len(accounts) == original_len:
        return False
    await _save_accounts(accounts)
    return True


async def bulk_import_accounts(
    items: list[dict], mode: str = "merge"
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
        await _save_accounts(new_accounts)
    else:
        accounts = await load_accounts()
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
        await _save_accounts(accounts)

    return result
