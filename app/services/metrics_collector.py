"""In-memory metrics collector using Ring Buffer + SQLite persistence.

The ring buffer provides fast in-memory queries for recent data,
while MetricsStore persists all metrics to SQLite for long-term
trend analysis and survival across restarts.
"""

from __future__ import annotations

import time
from collections import defaultdict
from dataclasses import dataclass, field

from app.services.metrics_store import MetricsStore
from app.utils.logger import log


BUCKET_COUNT = 1440  # 24h × 60min
BUCKET_DURATION_MS = 60_000  # 1 minute


@dataclass
class MetricsBucket:
    timestamp: int = 0
    request_count: int = 0
    error_count: int = 0
    total_latency_ms: int = 0
    model_counts: dict[str, int] = field(default_factory=dict)
    account_counts: dict[str, int] = field(default_factory=dict)


def _bucket_timestamp(now_ms: int) -> int:
    return (now_ms // BUCKET_DURATION_MS) * BUCKET_DURATION_MS


class MetricsCollector:
    """Collects and queries request metrics with dual storage.

    - In-memory ring buffer: fast queries for recent data (1h/6h/24h)
    - SQLite MetricsStore: persistent storage for long-term analysis
    """

    def __init__(self, metrics_store: MetricsStore | None = None) -> None:
        now = _bucket_timestamp(int(time.time() * 1000))
        self._buckets: list[MetricsBucket] = [MetricsBucket() for _ in range(BUCKET_COUNT)]
        self._buckets[0] = MetricsBucket(timestamp=now)
        self._current_index = 0
        self._store = metrics_store

    def record(
        self, model: str, account_id: str, latency_ms: int, success: bool
    ) -> None:
        """Record a single request metric to both ring buffer and persistent store."""
        now_ms = int(time.time() * 1000)
        ts = _bucket_timestamp(now_ms)
        bucket = self._get_or_create_bucket(ts)

        bucket.request_count += 1
        if not success:
            bucket.error_count += 1
        bucket.total_latency_ms += latency_ms
        bucket.model_counts[model] = bucket.model_counts.get(model, 0) + 1
        bucket.account_counts[account_id] = (
            bucket.account_counts.get(account_id, 0) + 1
        )

        # Persist to SQLite
        if self._store:
            try:
                self._store.record(model, account_id, latency_ms, success)
            except Exception as e:
                log.error("Failed to persist metric to store", extra={"error": str(e)})

    def get_time_series(self, range_str: str) -> dict:
        """Get time series data for a given range from ring buffer."""
        range_ms = {"1h": 3600_000, "6h": 21600_000, "24h": 86400_000}.get(
            range_str, 86400_000
        )
        now_ms = int(time.time() * 1000)
        since = _bucket_timestamp(now_ms - range_ms)

        result = []
        for bucket in self._buckets:
            if bucket.timestamp >= since and bucket.timestamp <= now_ms and bucket.request_count > 0:
                result.append(
                    {
                        "timestamp": bucket.timestamp,
                        "requestCount": bucket.request_count,
                        "errorCount": bucket.error_count,
                        "avgLatencyMs": (
                            round(bucket.total_latency_ms / bucket.request_count)
                            if bucket.request_count > 0
                            else 0
                        ),
                    }
                )

        result.sort(key=lambda b: b["timestamp"])
        return {"buckets": result, "range": range_str}

    def get_breakdown(self) -> dict:
        """Get 24h aggregated breakdown from ring buffer."""
        now_ms = int(time.time() * 1000)
        since = _bucket_timestamp(now_ms - 86400_000)

        model_totals: dict[str, int] = defaultdict(int)
        account_totals: dict[str, int] = defaultdict(int)
        total_requests = 0
        total_errors = 0
        total_latency = 0

        for bucket in self._buckets:
            if bucket.timestamp >= since and bucket.timestamp <= now_ms and bucket.request_count > 0:
                total_requests += bucket.request_count
                total_errors += bucket.error_count
                total_latency += bucket.total_latency_ms
                for model, count in bucket.model_counts.items():
                    model_totals[model] += count
                for acc, count in bucket.account_counts.items():
                    account_totals[acc] += count

        by_model = sorted(
            [
                {
                    "model": m,
                    "count": c,
                    "percentage": round(c / total_requests * 100, 2) if total_requests > 0 else 0,
                }
                for m, c in model_totals.items()
            ],
            key=lambda x: x["count"],
            reverse=True,
        )

        by_account = sorted(
            [
                {
                    "accountId": a,
                    "count": c,
                    "percentage": round(c / total_requests * 100, 2) if total_requests > 0 else 0,
                }
                for a, c in account_totals.items()
            ],
            key=lambda x: x["count"],
            reverse=True,
        )

        return {
            "byModel": by_model,
            "byAccount": by_account,
            "totals": {
                "requests": total_requests,
                "errors": total_errors,
                "avgLatencyMs": round(total_latency / total_requests) if total_requests > 0 else 0,
                "errorRate": round(total_errors / total_requests * 100, 2) if total_requests > 0 else 0,
            },
            "since": since,
        }

    def get_persistent_time_series(self, range_str: str) -> dict:
        """Get time series from persistent SQLite store (for ranges > 24h)."""
        if self._store:
            return self._store.get_time_series(range_str)
        return self.get_time_series(range_str)

    def get_persistent_breakdown(self) -> dict:
        """Get breakdown from persistent SQLite store."""
        if self._store:
            return self._store.get_breakdown()
        return self.get_breakdown()

    def _get_or_create_bucket(self, ts: int) -> MetricsBucket:
        current = self._buckets[self._current_index]
        if current.timestamp == ts:
            return current

        steps = (ts - current.timestamp) // BUCKET_DURATION_MS
        if 0 < steps < BUCKET_COUNT:
            for i in range(1, min(steps, BUCKET_COUNT) + 1):
                idx = (self._current_index + i) % BUCKET_COUNT
                self._buckets[idx] = MetricsBucket(
                    timestamp=current.timestamp + i * BUCKET_DURATION_MS
                )
            self._current_index = (self._current_index + steps) % BUCKET_COUNT
        elif steps >= BUCKET_COUNT:
            self._buckets = [MetricsBucket() for _ in range(BUCKET_COUNT)]
            self._current_index = 0
            self._buckets[0] = MetricsBucket(timestamp=ts)

        if self._buckets[self._current_index].timestamp != ts:
            self._buckets[self._current_index] = MetricsBucket(timestamp=ts)
        return self._buckets[self._current_index]


# Global singleton (will be replaced by dependency injection in a later commit)
metrics_collector = MetricsCollector()
