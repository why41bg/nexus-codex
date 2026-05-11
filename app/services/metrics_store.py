"""SQLite-backed metrics store for persistent metric storage.

Provides the same interface as MetricsCollector but persists data to
a SQLite database, enabling long-term trend analysis and surviving
service restarts.
"""

from __future__ import annotations

import asyncio
import sqlite3
import time
from collections import defaultdict
from pathlib import Path

from app.utils.logger import log

DATA_DIR = Path(__file__).parent.parent.parent / "data"
DB_PATH = DATA_DIR / "metrics.db"
DEFAULT_RETENTION_DAYS = 30


def _ensure_db(db_path: str | None = None, *, check_same_thread: bool = True) -> sqlite3.Connection:
    """Ensure the metrics database and table exist, return a connection."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path or str(DB_PATH), check_same_thread=check_same_thread)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS metrics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp_ms INTEGER NOT NULL,
            model TEXT NOT NULL,
            account_id TEXT NOT NULL,
            latency_ms INTEGER NOT NULL,
            success INTEGER NOT NULL DEFAULT 1,
            api_key TEXT NOT NULL DEFAULT ''
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_metrics_ts
        ON metrics(timestamp_ms)
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_metrics_model
        ON metrics(model)
    """)
    # Migrate: add api_key column if missing (existing databases)
    try:
        conn.execute("SELECT api_key FROM metrics LIMIT 1")
    except sqlite3.OperationalError:
        conn.execute("ALTER TABLE metrics ADD COLUMN api_key TEXT NOT NULL DEFAULT ''")
        conn.commit()
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_metrics_api_key
        ON metrics(api_key)
    """)
    conn.commit()
    return conn


def _cleanup_old(conn: sqlite3.Connection, retention_days: int) -> None:
    """Remove metrics older than retention_days."""
    cutoff_ms = int((time.time() - retention_days * 86400) * 1000)
    conn.execute("DELETE FROM metrics WHERE timestamp_ms < ?", (cutoff_ms,))
    conn.commit()


class MetricsStore:
    """SQLite-backed persistent metrics storage.

    Records individual request metrics and provides time-series
    and breakdown queries. Data is retained for retention_days
    (default 30 days).
    """

    def __init__(self, retention_days: int = DEFAULT_RETENTION_DAYS) -> None:
        self._retention_days = retention_days
        self._conn = _ensure_db(str(DB_PATH), check_same_thread=False)
        self._write_lock = asyncio.Lock()
        _cleanup_old(self._conn, retention_days)
        log.info(
            "MetricsStore initialized",
            extra={"db_path": str(DB_PATH), "retention_days": retention_days},
        )

    async def record(
        self, model: str, account_id: str, latency_ms: int, success: bool, api_key: str = ""
    ) -> None:
        """Record a single request metric."""
        now_ms = int(time.time() * 1000)
        try:
            async with self._write_lock:
                self._conn.execute(
                    "INSERT INTO metrics (timestamp_ms, model, account_id, latency_ms, success, api_key) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (now_ms, model, account_id, latency_ms, 1 if success else 0, api_key),
                )
                self._conn.commit()
        except Exception as e:
            log.error("Failed to persist metric", extra={"error": str(e)})

    def get_time_series(self, range_str: str) -> dict:
        """Get time series data aggregated by minute buckets."""
        range_ms = {"1h": 3600_000, "6h": 21600_000, "24h": 86400_000}.get(
            range_str, 86400_000
        )
        now_ms = int(time.time() * 1000)
        since_ms = now_ms - range_ms

        bucket_ms = 60_000  # 1 minute buckets
        rows = self._conn.execute(
            """
            SELECT
                (timestamp_ms / ?) * ? AS bucket_ts,
                COUNT(*) AS request_count,
                SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS error_count,
                AVG(latency_ms) AS avg_latency
            FROM metrics
            WHERE timestamp_ms >= ? AND timestamp_ms <= ?
            GROUP BY bucket_ts
            ORDER BY bucket_ts
            """,
            (bucket_ms, bucket_ms, since_ms, now_ms),
        ).fetchall()

        buckets = [
            {
                "timestamp": row[0],
                "requestCount": row[1],
                "errorCount": row[2],
                "avgLatencyMs": round(row[3]) if row[3] else 0,
            }
            for row in rows
        ]

        return {"buckets": buckets, "range": range_str}

    def get_breakdown(self) -> dict:
        """Get 24h aggregated breakdown by model and account."""
        now_ms = int(time.time() * 1000)
        since_ms = now_ms - 86400_000

        # By model
        model_rows = self._conn.execute(
            """
            SELECT model, COUNT(*) AS cnt
            FROM metrics
            WHERE timestamp_ms >= ? AND timestamp_ms <= ?
            GROUP BY model
            ORDER BY cnt DESC
            """,
            (since_ms, now_ms),
        ).fetchall()

        # By account
        account_rows = self._conn.execute(
            """
            SELECT account_id, COUNT(*) AS cnt
            FROM metrics
            WHERE timestamp_ms >= ? AND timestamp_ms <= ?
            GROUP BY account_id
            ORDER BY cnt DESC
            """,
            (since_ms, now_ms),
        ).fetchall()

        # Totals
        totals_row = self._conn.execute(
            """
            SELECT
                COUNT(*) AS total_requests,
                COALESCE(SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END), 0) AS total_errors,
                COALESCE(AVG(latency_ms), 0) AS avg_latency
            FROM metrics
            WHERE timestamp_ms >= ? AND timestamp_ms <= ?
            """,
            (since_ms, now_ms),
        ).fetchone()

        total_requests = totals_row[0] or 0
        total_errors = totals_row[1] or 0
        avg_latency = round(totals_row[2])

        by_model = [
            {
                "model": row[0],
                "count": row[1],
                "percentage": round(row[1] / total_requests * 100, 2) if total_requests > 0 else 0,
            }
            for row in model_rows
        ]

        by_account = [
            {
                "accountId": row[0],
                "count": row[1],
                "percentage": round(row[1] / total_requests * 100, 2) if total_requests > 0 else 0,
            }
            for row in account_rows
        ]

        return {
            "byModel": by_model,
            "byAccount": by_account,
            "totals": {
                "requests": total_requests,
                "errors": total_errors,
                "avgLatencyMs": avg_latency,
                "errorRate": round(total_errors / total_requests * 100, 2) if total_requests > 0 else 0,
            },
            "since": since_ms,
        }

    def get_percentiles(self, range_str: str) -> dict:
        """Get P50/P95/P99 latency percentiles for a given range."""
        range_ms = {"1h": 3600_000, "6h": 21600_000, "24h": 86400_000, "7d": 604800_000, "30d": 2592000_000}.get(
            range_str, 86400_000
        )
        now_ms = int(time.time() * 1000)
        since_ms = now_ms - range_ms

        rows = self._conn.execute(
            "SELECT latency_ms FROM metrics WHERE timestamp_ms >= ? AND timestamp_ms <= ? ORDER BY latency_ms",
            (since_ms, now_ms),
        ).fetchall()

        latencies = [row[0] for row in rows]
        if not latencies:
            return {"p50": 0, "p95": 0, "p99": 0, "range": range_str, "sampleCount": 0}

        n = len(latencies)

        def _pct(p: float) -> int:
            idx = int(n * p / 100)
            return round(latencies[min(idx, n - 1)])

        return {
            "p50": _pct(50),
            "p95": _pct(95),
            "p99": _pct(99),
            "range": range_str,
            "sampleCount": n,
        }

    def get_summary(self, range_str: str) -> dict:
        """Get KPI summary with period-over-period comparison."""
        range_ms = {"1h": 3600_000, "6h": 21600_000, "24h": 86400_000, "7d": 604800_000, "30d": 2592000_000}.get(
            range_str, 86400_000
        )
        now_ms = int(time.time() * 1000)

        def _query_period(since: int, until: int) -> dict:
            row = self._conn.execute(
                """
                SELECT
                    COUNT(*) AS requests,
                    COALESCE(SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END), 0) AS errors,
                    COALESCE(AVG(latency_ms), 0) AS avg_latency
                FROM metrics
                WHERE timestamp_ms >= ? AND timestamp_ms <= ?
                """,
                (since, until),
            ).fetchone()

            requests = row[0] or 0
            errors = row[1] or 0
            avg_latency = round(row[2])
            success_rate = round((1 - errors / requests) * 100, 2) if requests > 0 else 100.0
            error_rate = round(errors / requests * 100, 2) if requests > 0 else 0.0

            return {
                "requests": requests,
                "errors": errors,
                "avgLatencyMs": avg_latency,
                "successRate": success_rate,
                "errorRate": error_rate,
            }

        current = _query_period(now_ms - range_ms, now_ms)
        previous = _query_period(now_ms - 2 * range_ms, now_ms - range_ms)

        def _pct_change(cur: float, prev: float) -> float | None:
            if prev == 0:
                return None if cur == 0 else 100.0
            return round((cur - prev) / prev * 100, 2)

        return {
            "current": current,
            "previous": previous,
            "changes": {
                "requests": _pct_change(current["requests"], previous["requests"]),
                "errors": _pct_change(current["errors"], previous["errors"]),
                "avgLatencyMs": _pct_change(current["avgLatencyMs"], previous["avgLatencyMs"]),
                "successRate": (
                    round(current["successRate"] - previous["successRate"], 2)
                    if previous["requests"] > 0
                    else None
                ),
                "errorRate": (
                    round(current["errorRate"] - previous["errorRate"], 2)
                    if previous["requests"] > 0
                    else None
                ),
            },
            "range": range_str,
        }

    def get_per_key_stats(self, range_str: str) -> dict:
        """Get per API key usage stats for a given time range."""
        range_ms = {"1h": 3600_000, "6h": 21600_000, "24h": 86400_000, "7d": 604800_000, "30d": 2592000_000}.get(
            range_str, 86400_000
        )
        now_ms = int(time.time() * 1000)
        since_ms = now_ms - range_ms

        rows = self._conn.execute(
            """
            SELECT
                api_key,
                COUNT(*) AS total_requests,
                SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS total_errors,
                AVG(latency_ms) AS avg_latency,
                MAX(timestamp_ms) AS last_used
            FROM metrics
            WHERE timestamp_ms >= ? AND timestamp_ms <= ? AND api_key != ''
            GROUP BY api_key
            ORDER BY total_requests DESC
            """,
            (since_ms, now_ms),
        ).fetchall()

        keys = []
        for row in rows:
            total = row[1]
            errors = row[2] or 0
            keys.append({
                "apiKeyPrefix": row[0][:12] if len(row[0]) >= 12 else row[0],
                "totalRequests": total,
                "totalErrors": errors,
                "errorRate": round(errors / total * 100, 2) if total > 0 else 0,
                "avgLatencyMs": round(row[3]) if row[3] else 0,
                "lastUsed": row[4],
            })

        return {"keys": keys, "range": range_str}

    def close(self) -> None:
        """Close the database connection."""
        self._conn.close()
