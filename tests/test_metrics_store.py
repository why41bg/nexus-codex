"""Unit tests for MetricsStore — SQLite-backed persistent metrics."""

from __future__ import annotations

import sqlite3
import time
from pathlib import Path
from unittest.mock import patch

import pytest


# ═══════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════


@pytest.fixture
def metrics_store(tmp_path):
    """Create a MetricsStore with a temporary database."""
    from app.services.metrics_store import MetricsStore

    # Patch DB_PATH to use tmp_path
    db_path = tmp_path / "metrics.db"
    with patch("app.services.metrics_store.DB_PATH", db_path):
        with patch("app.services.metrics_store.DATA_DIR", tmp_path):
            store = MetricsStore(retention_days=30)
            yield store
            store.close()



# ═══════════════════════════════════════════════════════════════
# record
# ═══════════════════════════════════════════════════════════════


class TestRecord:
    def test_record_single_metric(self, metrics_store):
        metrics_store.record("gpt-5.5", "acc-1", 150, True)

        # Verify via get_breakdown
        breakdown = metrics_store.get_breakdown()
        assert breakdown["totals"]["requests"] == 1

    def test_record_multiple_metrics(self, metrics_store):
        metrics_store.record("gpt-5.5", "acc-1", 100, True)
        metrics_store.record("gpt-5.5", "acc-1", 200, True)
        metrics_store.record("gpt-5.4", "acc-2", 300, False)

        breakdown = metrics_store.get_breakdown()
        assert breakdown["totals"]["requests"] == 3
        assert breakdown["totals"]["errors"] == 1

    def test_record_db_error_suppressed(self, metrics_store):
        """DB errors during record should be caught."""
        metrics_store._conn.close()
        # Should not raise
        metrics_store.record("gpt-5.5", "acc-1", 100, True)


# ═══════════════════════════════════════════════════════════════
# get_time_series
# ═══════════════════════════════════════════════════════════════


class TestGetTimeSeries:
    def test_empty_returns_empty_buckets(self, metrics_store):
        result = metrics_store.get_time_series("1h")
        assert result["buckets"] == []
        assert result["range"] == "1h"

    def test_returns_buckets(self, metrics_store):
        metrics_store.record("gpt-5.5", "acc-1", 100, True)
        metrics_store.record("gpt-5.5", "acc-1", 200, True)

        result = metrics_store.get_time_series("1h")
        assert len(result["buckets"]) >= 1
        bucket = result["buckets"][0]
        assert bucket["requestCount"] == 2
        assert bucket["errorCount"] == 0

    def test_different_ranges(self, metrics_store):
        metrics_store.record("gpt-5.5", "acc-1", 100, True)

        for r in ["1h", "6h", "24h"]:
            result = metrics_store.get_time_series(r)
            assert result["range"] == r


# ═══════════════════════════════════════════════════════════════
# get_breakdown
# ═══════════════════════════════════════════════════════════════


class TestGetBreakdown:
    def test_empty_breakdown(self, metrics_store):
        result = metrics_store.get_breakdown()
        assert result["totals"]["requests"] == 0
        assert result["byModel"] == []
        assert result["byAccount"] == []

    def test_breakdown_by_model(self, metrics_store):
        metrics_store.record("gpt-5.5", "acc-1", 100, True)
        metrics_store.record("gpt-5.5", "acc-1", 200, True)
        metrics_store.record("gpt-5.4", "acc-1", 150, True)

        result = metrics_store.get_breakdown()
        models = {m["model"]: m["count"] for m in result["byModel"]}
        assert models["gpt-5.5"] == 2
        assert models["gpt-5.4"] == 1

    def test_breakdown_by_account(self, metrics_store):
        metrics_store.record("gpt-5.5", "acc-1", 100, True)
        metrics_store.record("gpt-5.5", "acc-2", 200, True)

        result = metrics_store.get_breakdown()
        accounts = {a["accountId"]: a["count"] for a in result["byAccount"]}
        assert accounts["acc-1"] == 1
        assert accounts["acc-2"] == 1

    def test_error_rate(self, metrics_store):
        metrics_store.record("gpt-5.5", "acc-1", 100, True)
        metrics_store.record("gpt-5.5", "acc-1", 200, False)

        result = metrics_store.get_breakdown()
        assert result["totals"]["errorRate"] == 50.0


# ═══════════════════════════════════════════════════════════════
# get_percentiles
# ═══════════════════════════════════════════════════════════════


class TestGetPercentiles:
    def test_empty_returns_zeros(self, metrics_store):
        result = metrics_store.get_percentiles("24h")
        assert result["p50"] == 0
        assert result["p95"] == 0
        assert result["p99"] == 0
        assert result["sampleCount"] == 0

    def test_percentiles_with_data(self, metrics_store):
        for lat in [100, 200, 300, 400, 500]:
            metrics_store.record("gpt-5.5", "acc-1", lat, True)

        result = metrics_store.get_percentiles("24h")
        assert result["sampleCount"] == 5
        assert result["p50"] > 0
        assert result["p99"] > 0


# ═══════════════════════════════════════════════════════════════
# get_summary
# ═══════════════════════════════════════════════════════════════


class TestGetSummary:
    def test_empty_summary(self, metrics_store):
        result = metrics_store.get_summary("24h")
        assert result["current"]["requests"] == 0
        assert result["range"] == "24h"

    def test_summary_with_data(self, metrics_store):
        metrics_store.record("gpt-5.5", "acc-1", 100, True)
        metrics_store.record("gpt-5.5", "acc-1", 200, True)

        result = metrics_store.get_summary("24h")
        assert result["current"]["requests"] == 2
        assert result["current"]["successRate"] == 100.0
        assert "changes" in result
