from __future__ import annotations

"""Account persistence store - manages data/accounts.json."""

import asyncio
import json
import os
import uuid
from pathlib import Path

from app.models import Account
from app.utils.logger import log

DATA_DIR = Path(__file__).parent.parent.parent / "data"
DATA_PATH = DATA_DIR / "accounts.json"

_accounts_cache: list[Account] | None = None
_write_lock = asyncio.Lock()


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
    """Update an existing account."""
    accounts = await load_accounts()
    for i, acc in enumerate(accounts):
        if acc.id == account_id:
            data = acc.model_dump()
            data.update({k: v for k, v in updates.items() if v is not None})
            accounts[i] = Account(**data)
            await _save_accounts(accounts)
            return accounts[i]
    return None


async def increment_usage_count(account_id: str) -> None:
    """Atomically increment usage count."""
    from datetime import datetime, timezone

    accounts = await load_accounts()
    for acc in accounts:
        if acc.id == account_id:
            acc.usage_count += 1
            acc.last_used_at = datetime.now(timezone.utc).isoformat()
            await _save_accounts(accounts)
            return


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
