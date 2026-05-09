"""Tests for MetricsCollector (delegation layer over MetricsStore)."""

from unittest.mock import MagicMock

from app.services.metrics_collector import MetricsCollector


class TestMetricsCollector:
    def test_record_and_get_time_series(self):
        mock_store = MagicMock()
        mock_store.get_time_series.return_value = {
            "buckets": [{"requestCount": 3, "errorCount": 1, "avgLatencyMs": 200}],
            "range": "1h",
        }
        mc = MetricsCollector(mock_store)
        mc.record("gpt-4", "acc-1", 100, True)
        mc.record("gpt-4", "acc-1", 200, True)
        mc.record("gpt-4", "acc-2", 300, False)

        assert mock_store.record.call_count == 3

        ts = mc.get_time_series("1h")
        assert "buckets" in ts
        assert ts["range"] == "1h"

        buckets = ts["buckets"]
        assert len(buckets) >= 1
        bucket = buckets[0]
        assert bucket["requestCount"] == 3
        assert bucket["errorCount"] == 1
        assert bucket["avgLatencyMs"] == 200

    def test_get_breakdown(self):
        mock_store = MagicMock()
        mock_store.get_breakdown.return_value = {
            "byModel": [{"model": "gpt-4", "count": 2}, {"model": "gpt-3.5", "count": 1}],
            "byAccount": [],
            "totals": {"requests": 3, "errors": 0, "avgLatencyMs": 150, "errorRate": 0.0},
        }
        mc = MetricsCollector(mock_store)
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
        mock_store = MagicMock()
        mock_store.get_time_series.return_value = {
            "buckets": [{"requestCount": 1, "errorCount": 1, "avgLatencyMs": 500}],
            "range": "1h",
        }
        mock_store.get_breakdown.return_value = {
            "byModel": [],
            "byAccount": [],
            "totals": {"requests": 1, "errors": 1, "avgLatencyMs": 500, "errorRate": 100.0},
        }
        mc = MetricsCollector(mock_store)
        mc.record("gpt-4", "acc-1", 500, False)

        ts = mc.get_time_series("1h")
        bucket = ts["buckets"][0]
        assert bucket["requestCount"] == 1
        assert bucket["errorCount"] == 1

        breakdown = mc.get_breakdown()
        assert breakdown["totals"]["errorRate"] == 100.0

    def test_get_percentiles(self):
        mock_store = MagicMock()
        mock_store.get_percentiles.return_value = {"p50": 100, "p95": 200, "p99": 300}
        mc = MetricsCollector(mock_store)

        result = mc.get_percentiles("1h")
        assert result["p50"] == 100
        assert result["p95"] == 200
        assert result["p99"] == 300
        mock_store.get_percentiles.assert_called_once_with("1h")

    def test_get_summary(self):
        mock_store = MagicMock()
        mock_store.get_summary.return_value = {
            "totalRequests": 100,
            "errorRate": 2.0,
            "avgLatencyMs": 150,
        }
        mc = MetricsCollector(mock_store)

        result = mc.get_summary("24h")
        assert result["totalRequests"] == 100
        assert result["errorRate"] == 2.0
        mock_store.get_summary.assert_called_once_with("24h")

    def test_record_handles_store_exception(self):
        mock_store = MagicMock()
        mock_store.record.side_effect = RuntimeError("db error")
        mc = MetricsCollector(mock_store)

        # Should not raise — exceptions are caught and logged
        mc.record("gpt-4", "acc-1", 100, True)
        mock_store.record.assert_called_once()