"""Metrics collector — thin delegation layer over SQLite MetricsStore.

All metrics are persisted to SQLite for survival across restarts.
"""

from __future__ import annotations

from app.services.metrics_store import MetricsStore
from app.utils.logger import log


class MetricsCollector:
    """Collects and queries request metrics via SQLite persistence."""

    def __init__(self, metrics_store: MetricsStore) -> None:
        self._store = metrics_store

    async def record(
        self, model: str, account_id: str, latency_ms: int, success: bool, api_key: str = ""
    ) -> None:
        """Record a single request metric to persistent store."""
        try:
            await self._store.record(model, account_id, latency_ms, success, api_key)
        except Exception as e:
            log.error("Failed to persist metric", extra={"error": str(e)})

    async def get_time_series(self, range_str: str) -> dict:
        """Get time series data from persistent store."""
        return await self._store.get_time_series(range_str)

    async def get_breakdown(self) -> dict:
        """Get 24h aggregated breakdown from persistent store."""
        return await self._store.get_breakdown()

    async def get_percentiles(self, range_str: str) -> dict:
        """Get latency percentiles (P50/P95/P99) from persistent store."""
        return await self._store.get_percentiles(range_str)

    async def get_summary(self, range_str: str) -> dict:
        """Get KPI summary with period-over-period comparison."""
        return await self._store.get_summary(range_str)

    async def get_per_key_stats(self, range_str: str) -> dict:
        """Get per API key usage stats."""
        return await self._store.get_per_key_stats(range_str)
