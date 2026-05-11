"""Pool-level quota snapshot service for public read-only exposure."""

from __future__ import annotations

import asyncio
import time
from typing import Any

from app.config import settings
from app.models import Account
from app.services.account_pool import AccountPool
from app.services.account_store import AccountStore
from app.services.quota_probe import QuotaInfo, QuotaProbeService
from app.utils.logger import log


class PoolQuotaSnapshotService:
    """Maintains the latest aggregated quota snapshot for the shared pool."""

    def __init__(
        self,
        *,
        account_store: AccountStore,
        account_pool: AccountPool,
        quota_probe_service: QuotaProbeService,
    ) -> None:
        self._account_store = account_store
        self._account_pool = account_pool
        self._quota_probe_service = quota_probe_service
        self._snapshot: dict[str, Any] | None = None
        self._lock = asyncio.Lock()
        self._refresh_task: asyncio.Task[dict[str, Any]] | None = None

    def _weight_for(self, account: Account, pool_status: dict[str, dict[str, Any]]) -> int:
        runtime = pool_status.get(account.id)
        weight = runtime.get("max_concurrency") if runtime else None
        if not isinstance(weight, int) or weight <= 0:
            weight = account.max_concurrency or settings.default_max_concurrency
        return max(1, int(weight))

    def _make_unavailable_snapshot(self) -> dict[str, Any]:
        now_ms = int(time.time() * 1000)
        return {
            "status": "unavailable",
            "snapshotAt": None,
            "staleAt": None,
            "window5hRemainingPercent": None,
            "window1wRemainingPercent": None,
            "healthyAccountCount": 0,
            "eligibleAccountCount": 0,
            "sampledAccountCount": 0,
            "eligibleWeight": 0,
            "sampledWeight": 0,
            "generatedAt": now_ms,
        }

    def _with_status(self, snapshot: dict[str, Any], status: str) -> dict[str, Any]:
        result = dict(snapshot)
        result["status"] = status
        return result

    def _snapshot_status(self, snapshot: dict[str, Any]) -> str:
        if snapshot.get("status") == "unavailable":
            return "unavailable"
        snapshot_at = snapshot.get("snapshotAt")
        if not snapshot_at:
            return snapshot.get("status", "unavailable")
        stale_after_ms = settings.pool_quota_stale_after_ms
        if int(time.time() * 1000) > int(snapshot_at) + stale_after_ms:
            return "stale"
        return snapshot.get("status", "ok")

    async def refresh_snapshot(self) -> dict[str, Any]:
        """Refresh aggregated pool quota snapshot from eligible accounts."""
        pool_status_list = self._account_pool.get_status()
        pool_status = {entry["account_id"]: entry for entry in pool_status_list}
        accounts = await self._account_store.load_accounts()
        eligible_accounts = [
            acc for acc in accounts
            if acc.enabled and pool_status.get(acc.id, {}).get("healthy", acc.healthy)
        ]

        healthy_account_count = sum(1 for acc in eligible_accounts if pool_status.get(acc.id, {}).get("healthy", acc.healthy))
        eligible_weight = sum(self._weight_for(acc, pool_status) for acc in eligible_accounts)

        if not eligible_accounts or eligible_weight <= 0:
            snapshot = self._make_unavailable_snapshot()
            snapshot["healthyAccountCount"] = healthy_account_count
            snapshot["eligibleAccountCount"] = len(eligible_accounts)
            self._snapshot = snapshot
            return snapshot

        pool_entries = {entry.account_id: entry for entry in self._account_pool.entries()}

        async def _fetch_one(account: Account) -> tuple[Account, QuotaInfo | None]:
            pool_entry = pool_entries.get(account.id)
            token_manager = pool_entry.token_manager if pool_entry else None
            quota = await self._quota_probe_service.refresh_quota(
                account.codex_home,
                token_manager=token_manager,
            )
            return account, quota

        results = await asyncio.gather(*(_fetch_one(acc) for acc in eligible_accounts), return_exceptions=True)

        sum_5h = 0.0
        sum_1w = 0.0
        sampled_weight = 0
        sampled_account_count = 0

        for item in results:
            if isinstance(item, Exception):
                continue
            account, quota = item
            if not quota:
                continue
            weight = self._weight_for(account, pool_status)
            sampled_weight += weight
            sampled_account_count += 1
            remaining_5h = max(0.0, 100.0 - float(quota.primary.used_percent))
            remaining_1w = max(0.0, 100.0 - float(quota.secondary.used_percent))
            sum_5h += remaining_5h * weight
            sum_1w += remaining_1w * weight

        if sampled_weight <= 0:
            if self._snapshot and self._snapshot.get("snapshotAt"):
                stale_snapshot = self._with_status(self._snapshot, "stale")
                stale_snapshot["healthyAccountCount"] = healthy_account_count
                stale_snapshot["eligibleAccountCount"] = len(eligible_accounts)
                stale_snapshot["sampledAccountCount"] = 0
                stale_snapshot["sampledWeight"] = 0
                stale_snapshot["eligibleWeight"] = eligible_weight
                self._snapshot = stale_snapshot
                return stale_snapshot

            snapshot = self._make_unavailable_snapshot()
            snapshot["healthyAccountCount"] = healthy_account_count
            snapshot["eligibleAccountCount"] = len(eligible_accounts)
            snapshot["eligibleWeight"] = eligible_weight
            self._snapshot = snapshot
            return snapshot

        now_ms = int(time.time() * 1000)
        status = "ok" if sampled_account_count == len(eligible_accounts) else "partial"
        snapshot = {
            "status": status,
            "snapshotAt": now_ms,
            "staleAt": now_ms + settings.pool_quota_stale_after_ms,
            "window5hRemainingPercent": round(sum_5h / sampled_weight, 2),
            "window1wRemainingPercent": round(sum_1w / sampled_weight, 2),
            "healthyAccountCount": healthy_account_count,
            "eligibleAccountCount": len(eligible_accounts),
            "sampledAccountCount": sampled_account_count,
            "eligibleWeight": eligible_weight,
            "sampledWeight": sampled_weight,
            "generatedAt": now_ms,
        }
        self._snapshot = snapshot
        return snapshot

    async def refresh_snapshot_singleflight(self) -> dict[str, Any]:
        """Refresh snapshot while coalescing concurrent refresh requests."""
        async with self._lock:
            if self._refresh_task and not self._refresh_task.done():
                task = self._refresh_task
            else:
                task = asyncio.create_task(self.refresh_snapshot())
                self._refresh_task = task
        try:
            return await task
        finally:
            async with self._lock:
                if self._refresh_task is task and task.done():
                    self._refresh_task = None

    def get_snapshot(self) -> dict[str, Any]:
        """Return the latest snapshot without triggering any probe."""
        if not self._snapshot:
            return self._make_unavailable_snapshot()
        status = self._snapshot_status(self._snapshot)
        return self._with_status(self._snapshot, status)

    async def refresh_if_empty(self) -> dict[str, Any]:
        """Refresh once when no snapshot exists yet."""
        if self._snapshot and self._snapshot.get("snapshotAt"):
            return self.get_snapshot()
        try:
            return await self.refresh_snapshot_singleflight()
        except Exception as exc:
            log.warning("pool-quota: initial refresh failed", extra={"error": str(exc)})
            return self.get_snapshot()
