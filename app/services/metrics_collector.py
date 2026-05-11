"""Metrics collector — buffered write layer over SQLite MetricsStore.

Provides a write-behind buffer that batches metric writes, reducing the
number of individual SQLite transactions on every request.  The buffer
is flushed automatically when it reaches ``BUFFER_SIZE`` entries or when
``FLUSH_INTERVAL_SEC`` seconds have elapsed since the last flush.

Query methods delegate directly to MetricsStore.
"""

from __future__ import annotations

import asyncio
import time

from app.services.metrics_store import MetricsStore
from app.utils.logger import log

# ─── Buffer tuning ────────────────────────────────────────────────
BUFFER_SIZE = 50  # flush after this many pending records
FLUSH_INTERVAL_SEC = 5.0  # max seconds before an auto-flush


class MetricsCollector:
    """Collects and queries request metrics via SQLite persistence.

    Adds a write-behind buffer on top of ``MetricsStore`` so that
    high-throughput request paths incur fewer synchronous DB writes.
    """

    def __init__(self, metrics_store: MetricsStore) -> None:
        self._store = metrics_store
        self._buffer: list[tuple[str, str, int, bool, str]] = []
        self._last_flush: float = time.monotonic()
        self._flush_lock = asyncio.Lock()

    async def record(
        self, model: str, account_id: str, latency_ms: int, success: bool, api_key: str = ""
    ) -> None:
        """Buffer a single request metric and flush when thresholds are met."""
        self._buffer.append((model, account_id, latency_ms, success, api_key))

        should_flush = (
            len(self._buffer) >= BUFFER_SIZE
            or (time.monotonic() - self._last_flush) >= FLUSH_INTERVAL_SEC
        )
        if should_flush:
            await self.flush()

    async def flush(self) -> None:
        """Persist all buffered metrics to the store."""
        async with self._flush_lock:
            if not self._buffer:
                self._last_flush = time.monotonic()
                return
            batch = list(self._buffer)
            self._buffer.clear()
            self._last_flush = time.monotonic()

            for model, account_id, latency_ms, success, api_key in batch:
                try:
                    await self._store.record(model, account_id, latency_ms, success, api_key)
                except Exception as e:
                    log.error("Failed to persist metric", extra={"error": str(e)})

    # ─── Query delegates (read-through) ────────────────────────────

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
