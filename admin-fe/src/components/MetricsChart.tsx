import { useState, useEffect, useCallback } from 'react';
import type { TimeSeriesResponse, MetricsBreakdown, PercentileResponse, SummaryResponse } from '@/types';
import { getAuthToken, API_BASE } from '@/lib/api';
import RequestTrendChart from './RequestTrendChart';
import ErrorRateChart from './ErrorRateChart';
import LatencyChart from './LatencyChart';
import ModelDonut from './ModelDonut';
import AccountBarChart from './AccountBarChart';

type Range = '1h' | '6h' | '24h';

interface Props {
  onSummaryChange: (summary: SummaryResponse | null) => void;
  onPercentilesChange: (percentiles: PercentileResponse | null) => void;
}

export default function MetricsChart({ onSummaryChange, onPercentilesChange }: Props) {
  const [range, setRange] = useState<Range>('1h');
  const [timeSeries, setTimeSeries] = useState<TimeSeriesResponse | null>(null);
  const [breakdown, setBreakdown] = useState<MetricsBreakdown | null>(null);
  const [percentiles, setPercentiles] = useState<PercentileResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const headers = { Authorization: `Bearer ${getAuthToken()}` };
      const [tsRes, bdRes, pctRes, sumRes] = await Promise.all([
        fetch(`${API_BASE}/api/admin/metrics/timeseries?range=${range}`, { headers }),
        fetch(`${API_BASE}/api/admin/metrics/breakdown`, { headers }),
        fetch(`${API_BASE}/api/admin/metrics/percentiles?range=${range}`, { headers }),
        fetch(`${API_BASE}/api/admin/metrics/summary?range=${range}`, { headers }),
      ]);

      if (tsRes.ok) {
        const tsData = (await tsRes.json()) as TimeSeriesResponse;
        setTimeSeries(tsData);
      }
      if (bdRes.ok) {
        const bdData = (await bdRes.json()) as MetricsBreakdown;
        setBreakdown(bdData);
      }
      if (pctRes.ok) {
        const pctData = (await pctRes.json()) as PercentileResponse;
        setPercentiles(pctData);
        onPercentilesChange(pctData);
      }
      if (sumRes.ok) {
        const sumData = (await sumRes.json()) as SummaryResponse;
        onSummaryChange(sumData);
      }
    } catch {
      // silently ignore network errors
    } finally {
      setLoading(false);
    }
  }, [range, onSummaryChange, onPercentilesChange]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const buckets = timeSeries?.buckets ?? [];

  const rangeButtons: { label: string; value: Range }[] = [
    { label: '1 小时', value: '1h' },
    { label: '6 小时', value: '6h' },
    { label: '24 小时', value: '24h' },
  ];

  return (
    <div className="mt-6 space-y-4">
      {/* 时间范围选择器 */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-gray-500 dark:text-slate-400">时间范围</span>
        {rangeButtons.map((btn) => (
          <button
            key={btn.value}
            onClick={() => setRange(btn.value)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              range === btn.value
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600'
            }`}
          >
            {btn.label}
          </button>
        ))}
        {loading && (
          <span className="ml-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
        )}
      </div>

      {/* 趋势图：三列 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <RequestTrendChart buckets={buckets} />
        <ErrorRateChart buckets={buckets} />
        <LatencyChart buckets={buckets} percentiles={percentiles} />
      </div>

      {/* 分布图：两列 */}
      {breakdown && breakdown.totals.requests > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ModelDonut breakdown={breakdown} />
          <AccountBarChart breakdown={breakdown} />
        </div>
      )}
    </div>
  );
}
