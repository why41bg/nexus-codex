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

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get_snapshot(self) -> dict[str, Any]:
        """Return the latest snapshot, marking it stale if expired."""
        if not self._snapshot:
            return self._make_snapshot(status="unavailable")
        return self._with_staleness(self._snapshot)

    async def refresh(self) -> dict[str, Any]:
        """Refresh the snapshot (no-op if already in progress)."""
        if self._lock.locked():
            return self.get_snapshot()
        async with self._lock:
            try:
                self._snapshot = await self._build_snapshot()
            except Exception as exc:
                log.warning("pool-quota: refresh failed", extra={"error": str(exc)})
            return self.get_snapshot()

    async def ensure_snapshot(self) -> dict[str, Any]:
        """Refresh once if no snapshot exists yet."""
        if self._snapshot and self._snapshot.get("snapshotAt"):
            return self.get_snapshot()
        return await self.refresh()

    # ------------------------------------------------------------------
    # Snapshot building
    # ------------------------------------------------------------------

    async def _build_snapshot(self) -> dict[str, Any]:
        """Probe all eligible accounts and build a weighted quota snapshot."""
        accounts = await self._account_store.load_accounts()
        pool_status = self._pool_status_map()
        eligible = self._eligible_accounts(accounts, pool_status)

        healthy_count = sum(
            1 for a in eligible
            if pool_status.get(a.id, {}).get("healthy", a.healthy)
        )
        eligible_weight = sum(self._weight_for(a, pool_status) for a in eligible)

        if not eligible or eligible_weight <= 0:
            return self._make_snapshot(
                status="unavailable",
                healthyAccountCount=healthy_count,
                eligibleAccountCount=len(eligible),
            )

        # Probe quotas in parallel
        pool_entries = {e.account_id: e for e in self._account_pool.entries()}
        results = await asyncio.gather(
            *(self._probe_one(a, pool_entries) for a in eligible),
            return_exceptions=True,
        )

        # Weighted aggregation
        sum_5h = 0.0
        sum_1w = 0.0
        sampled_weight = 0
        sampled_count = 0

        for item in results:
            if isinstance(item, Exception):
                continue
            account, quota = item
            if not quota:
                continue
            w = self._weight_for(account, pool_status)
            sampled_weight += w
            sampled_count += 1
            sum_5h += max(0.0, 100.0 - float(quota.primary.used_percent)) * w
            sum_1w += max(0.0, 100.0 - float(quota.secondary.used_percent)) * w

        if sampled_weight <= 0:
            return self._fallback_snapshot(
                healthy_count, len(eligible), eligible_weight,
            )

        now = int(time.time() * 1000)
        status = "ok" if sampled_count == len(eligible) else "partial"
        return {
            "status": status,
            "snapshotAt": now,
            "staleAt": now + settings.pool_quota_stale_after_ms,
            "window5hRemainingPercent": round(sum_5h / sampled_weight, 2),
            "window1wRemainingPercent": round(sum_1w / sampled_weight, 2),
            "healthyAccountCount": healthy_count,
            "eligibleAccountCount": len(eligible),
            "sampledAccountCount": sampled_count,
            "eligibleWeight": eligible_weight,
            "sampledWeight": sampled_weight,
            "generatedAt": now,
        }

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _pool_status_map(self) -> dict[str, dict[str, Any]]:
        return {s["account_id"]: s for s in self._account_pool.get_status()}

    @staticmethod
    def _eligible_accounts(
        accounts: list[Account],
        pool_status: dict[str, dict[str, Any]],
    ) -> list[Account]:
        return [
            a for a in accounts
            if a.enabled and pool_status.get(a.id, {}).get("healthy", a.healthy)
        ]

    def _weight_for(
        self, account: Account, pool_status: dict[str, dict[str, Any]],
    ) -> int:
        runtime = pool_status.get(account.id)
        weight = runtime.get("max_concurrency") if runtime else None
        if not isinstance(weight, int) or weight <= 0:
            weight = account.max_concurrency or settings.default_max_concurrency
        return max(1, int(weight))

    async def _probe_one(
        self, account: Account, pool_entries: dict[str, Any],
    ) -> tuple[Account, QuotaInfo | None]:
        entry = pool_entries.get(account.id)
        token_manager = entry.token_manager if entry else None
        quota = await self._quota_probe_service.refresh_quota(
            account.codex_home, token_manager=token_manager,
        )
        return account, quota

    def _fallback_snapshot(
        self, healthy_count: int, eligible_count: int, eligible_weight: int,
    ) -> dict[str, Any]:
        """When all probes fail, return stale previous snapshot or unavailable."""
        if self._snapshot and self._snapshot.get("snapshotAt"):
            snap = dict(self._snapshot)
            snap["status"] = "stale"
            snap["healthyAccountCount"] = healthy_count
            snap["eligibleAccountCount"] = eligible_count
            snap["sampledAccountCount"] = 0
            snap["sampledWeight"] = 0
            snap["eligibleWeight"] = eligible_weight
            return snap
        return self._make_snapshot(
            status="unavailable",
            healthyAccountCount=healthy_count,
            eligibleAccountCount=eligible_count,
            eligibleWeight=eligible_weight,
        )

    @staticmethod
    def _make_snapshot(status: str = "unavailable", **overrides: Any) -> dict[str, Any]:
        now = int(time.time() * 1000)
        snap: dict[str, Any] = {
            "status": status,
            "snapshotAt": None,
            "staleAt": None,
            "window5hRemainingPercent": None,
            "window1wRemainingPercent": None,
            "healthyAccountCount": 0,
            "eligibleAccountCount": 0,
            "sampledAccountCount": 0,
            "eligibleWeight": 0,
            "sampledWeight": 0,
            "generatedAt": now,
        }
        snap.update(overrides)
        return snap

    def _with_staleness(self, snapshot: dict[str, Any]) -> dict[str, Any]:
        """Return a copy of the snapshot with status adjusted for staleness."""
        if snapshot.get("status") == "unavailable":
            return dict(snapshot)
        snapshot_at = snapshot.get("snapshotAt")
        if not snapshot_at:
            return dict(snapshot)
        if int(time.time() * 1000) > int(snapshot_at) + settings.pool_quota_stale_after_ms:
            result = dict(snapshot)
            result["status"] = "stale"
            return result
        return dict(snapshot)