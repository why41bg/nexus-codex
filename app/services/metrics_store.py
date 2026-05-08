"""SQLite-backed metrics store for persistent metric storage.

Provides the same interface as MetricsCollector but persists data to
a SQLite database, enabling long-term trend analysis and surviving
service restarts.
"""

from __future__ import annotations

import sqlite3
import time
from collections import defaultdict
from pathlib import Path

from app.utils.logger import log

DATA_DIR = Path(__file__).parent.parent.parent / "data"
DB_PATH = DATA_DIR / "metrics.db"
DEFAULT_RETENTION_DAYS = 30


def _ensure_db() -> sqlite3.Connection:
    """Ensure the metrics database and table exist, return a connection."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("""
        CREATE TABLE IF NOT EXISTS metrics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp_ms INTEGER NOT NULL,
            model TEXT NOT NULL,
            account_id TEXT NOT NULL,
            latency_ms INTEGER NOT NULL,
            success INTEGER NOT NULL DEFAULT 1
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
        self._conn = _ensure_db()
        _cleanup_old(self._conn, retention_days)
        log.info(
            "MetricsStore initialized",
            extra={"db_path": str(DB_PATH), "retention_days": retention_days},
        )

    def record(
        self, model: str, account_id: str, latency_ms: int, success: bool
    ) -> None:
        """Record a single request metric."""
        now_ms = int(time.time() * 1000)
        try:
            self._conn.execute(
                "INSERT INTO metrics (timestamp_ms, model, account_id, latency_ms, success) "
                "VALUES (?, ?, ?, ?, ?)",
                (now_ms, model, account_id, latency_ms, 1 if success else 0),
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
                SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS total_errors,
                AVG(latency_ms) AS avg_latency
            FROM metrics
            WHERE timestamp_ms >= ? AND timestamp_ms <= ?
            """,
            (since_ms, now_ms),
        ).fetchone()

        total_requests = totals_row[0] if totals_row else 0
        total_errors = totals_row[1] if totals_row else 0
        avg_latency = round(totals_row[2]) if totals_row and totals_row[2] else 0

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

    def close(self) -> None:
        """Close the database connection."""
        self._conn.close()
