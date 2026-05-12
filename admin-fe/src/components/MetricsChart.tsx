import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { TimeSeriesResponse, MetricsBreakdown, PercentileResponse, SummaryResponse } from '@/types';
import { api } from '@/lib/api';
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

  // Use refs to hold callback props so they don't trigger re-renders
  const onSummaryChangeRef = useRef(onSummaryChange);
  const onPercentilesChangeRef = useRef(onPercentilesChange);
  useEffect(() => { onSummaryChangeRef.current = onSummaryChange; }, [onSummaryChange]);
  useEffect(() => { onPercentilesChangeRef.current = onPercentilesChange; }, [onPercentilesChange]);

  const { data: metricsData, isLoading: loading, error: queryError } = useQuery({
    queryKey: ['admin', 'metrics', 'chart', range],
    queryFn: async () => {
      const [tsRes, bdRes, pctRes, sumRes] = await Promise.all([
        api<TimeSeriesResponse>('GET', `/api/admin/metrics/timeseries?range=${range}`),
        api<MetricsBreakdown>('GET', '/api/admin/metrics/breakdown'),
        api<PercentileResponse>('GET', `/api/admin/metrics/percentiles?range=${range}`),
        api<SummaryResponse>('GET', `/api/admin/metrics/summary?range=${range}`),
      ]);

      const result = {
        timeSeries: tsRes.ok ? tsRes.data : null,
        breakdown: bdRes.ok ? bdRes.data : null,
        percentiles: pctRes.ok ? pctRes.data : null,
        summary: sumRes.ok ? sumRes.data : null,
      };

      // Notify parent of summary / percentiles changes
      if (result.percentiles) onPercentilesChangeRef.current(result.percentiles);
      if (result.summary) onSummaryChangeRef.current(result.summary);

      return result;
    },
    refetchInterval: 30_000,
  });

  const error = queryError ? '加载指标数据失败' : null;
  const buckets = metricsData?.timeSeries?.buckets ?? [];
  const breakdown = metricsData?.breakdown ?? null;
  const percentiles = metricsData?.percentiles ?? null;

  const rangeButtons: { label: string; value: Range }[] = [
    { label: '1 小时', value: '1h' },
    { label: '6 小时', value: '6h' },
    { label: '24 小时', value: '24h' },
  ];

  return (
    <div className="mt-6 space-y-4">
      {/* 加载失败提示 */}
      {error && (
        <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-4 py-2">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

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
