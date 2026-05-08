"""Tests for MetricsCollector (in-memory ring buffer)."""

import time

from app.services.metrics_collector import MetricsCollector


class TestMetricsCollector:
    def test_record_and_get_time_series(self):
        mc = MetricsCollector()
        mc.record("gpt-4", "acc-1", 100, True)
        mc.record("gpt-4", "acc-1", 200, True)
        mc.record("gpt-4", "acc-2", 300, False)

        ts = mc.get_time_series("1h")
        assert "buckets" in ts
        assert ts["range"] == "1h"

        buckets = ts["buckets"]
        assert len(buckets) >= 1

        # The bucket should have 3 requests, 1 error
        bucket = buckets[0]
        assert bucket["requestCount"] == 3
        assert bucket["errorCount"] == 1
        assert bucket["avgLatencyMs"] == 200  # (100+200+300)/3

    def test_get_breakdown(self):
        mc = MetricsCollector()
        mc.record("gpt-4", "acc-1", 100, True)
        mc.record("gpt-4", "acc-1", 200, True)
        mc.record("gpt-3.5", "acc-2", 150, True)

        breakdown = mc.get_breakdown()
        assert "byModel" in breakdown
        assert "byAccount" in breakdown
        assert "totals" in breakdown

        totals = breakdown["totals"]
        assert totals["requests"] == 3
        assert totals["errors"] == 0
        assert totals["avgLatencyMs"] == 150

        by_model = {m["model"]: m["count"] for m in breakdown["byModel"]}
        assert by_model["gpt-4"] == 2
        assert by_model["gpt-3.5"] == 1

    def test_record_error(self):
        mc = MetricsCollector()
        mc.record("gpt-4", "acc-1", 500, False)

        ts = mc.get_time_series("1h")
        bucket = ts["buckets"][0]
        assert bucket["requestCount"] == 1
        assert bucket["errorCount"] == 1

        breakdown = mc.get_breakdown()
        assert breakdown["totals"]["errorRate"] == 100.0

    def test_multiple_buckets(self):
        mc = MetricsCollector()
        # Record in current bucket
        mc.record("gpt-4", "acc-1", 100, True)

        # Simulate a future bucket by directly manipulating internal state
        now_ms = int(time.time() * 1000)
        future_ts = ((now_ms // 60000) + 2) * 60000
        mc._buckets[1] = type(mc._buckets[0])(
            timestamp=future_ts,
            request_count=5,
            error_count=1,
            total_latency_ms=500,
            model_counts={"gpt-4": 5},
            account_counts={"acc-1": 5},
        )

        ts = mc.get_time_series("1h")
        assert len(ts["buckets"]) >= 1

    def test_persistent_fallback(self):
        mc = MetricsCollector()
        # Without a store, persistent methods fall back to in-memory
        ts = mc.get_persistent_time_series("1h")
        assert "buckets" in ts

        bd = mc.get_persistent_breakdown()
        assert "totals" in bd
