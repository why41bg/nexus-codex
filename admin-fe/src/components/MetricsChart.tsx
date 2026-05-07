import { useState, useEffect, useCallback } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import type { TimeSeriesResponse, MetricsBreakdown } from '@/types';
import { getAuthToken, API_BASE } from '@/lib/api';
import { cardClass } from '@/lib/styles';
import { useTheme } from '@/contexts/ThemeContext';
type Range = '1h' | '6h' | '24h';

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function MetricsChart() {
  const { isDark } = useTheme();
  const [range, setRange] = useState<Range>('1h');
  const [timeSeries, setTimeSeries] = useState<TimeSeriesResponse | null>(null);
  const [breakdown, setBreakdown] = useState<MetricsBreakdown | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const headers = { Authorization: `Bearer ${getAuthToken()}` };
      const [tsRes, bdRes] = await Promise.all([
        fetch(`${API_BASE}/api/admin/metrics/timeseries?range=${range}`, { headers }),
        fetch(`${API_BASE}/api/admin/metrics/breakdown`, { headers }),
      ]);
      if (tsRes.ok) setTimeSeries(await tsRes.json());
      if (bdRes.ok) setBreakdown(await bdRes.json());
    } catch {
      // silently ignore network errors
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const chartData = (timeSeries?.buckets ?? []).map((b) => ({
    time: formatTime(b.timestamp),
    '请求数': b.requestCount,
    '错误数': b.errorCount,
    '延迟': b.avgLatencyMs,
  }));

  const rangeButtons: { label: string; value: Range }[] = [
    { label: '1 小时', value: '1h' },
    { label: '6 小时', value: '6h' },
    { label: '24 小时', value: '24h' },
  ];

  // Recharts 根据主题色配置
  const gridStroke = isDark ? '#334155' : '#f0f0f0';
  const tickFill = isDark ? '#94a3b8' : undefined;
  const tooltipBg = isDark ? '#1e293b' : '#fff';
  const tooltipBorder = isDark ? '#334155' : '#e5e7eb';

  return (
    <div className="mt-6 space-y-6">
      {/* 时间序列图表 */}
      <div className={`${cardClass} p-4`}>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300">请求趋势</h3>
          <div className="flex gap-1">
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
          </div>
        </div>

        {loading && !timeSeries ? (
          <div className="flex h-48 items-center justify-center text-sm text-gray-400 dark:text-slate-500">加载中…</div>
        ) : chartData.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-sm text-gray-400 dark:text-slate-500">暂无数据</div>
        ) : (
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                <XAxis dataKey="time" tick={{ fontSize: 11, fill: tickFill }} />
                <YAxis yAxisId="left" tick={{ fontSize: 11, fill: tickFill }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: tickFill }} unit="ms" />
                <Tooltip contentStyle={{ backgroundColor: tooltipBg, borderColor: tooltipBorder, borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="left" dataKey="请求数" fill="#6366f1" radius={[2, 2, 0, 0]} />
                <Bar yAxisId="left" dataKey="错误数" fill="#f97316" radius={[2, 2, 0, 0]} />
                <Line yAxisId="right" type="monotone" dataKey="延迟" stroke="#14b8a6" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Breakdown 分解 */}
      {breakdown && breakdown.totals.requests > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* 模型分布 */}
          <div className={`${cardClass} p-4`}>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300">模型分布 (24h)</h3>
            <div className="mt-3 space-y-2">
              {breakdown.byModel.slice(0, 8).map((item) => (
                <div key={item.model} className="flex items-center justify-between text-sm">
                  <span className="truncate text-gray-600 dark:text-slate-400" title={item.model}>{item.model}</span>
                  <span className="ml-2 shrink-0 text-gray-900 dark:text-slate-200">
                    {item.count} <span className="text-xs text-gray-400 dark:text-slate-500">({item.percentage}%)</span>
                  </span>
                </div>
              ))}
              {breakdown.byModel.length === 0 && (
                <p className="text-sm text-gray-400 dark:text-slate-500">暂无数据</p>
              )}
            </div>
          </div>

          {/* 账号分布 */}
          <div className={`${cardClass} p-4`}>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300">账号使用分布 (24h)</h3>
            <div className="mt-3 space-y-2">
              {breakdown.byAccount.slice(0, 8).map((item) => (
                <div key={item.accountId} className="flex items-center justify-between text-sm">
                  <span className="truncate font-mono text-xs text-gray-600 dark:text-slate-400" title={item.accountId}>
                    {item.accountId.slice(0, 12)}…
                  </span>
                  <span className="ml-2 shrink-0 text-gray-900 dark:text-slate-200">
                    {item.count} <span className="text-xs text-gray-400 dark:text-slate-500">({item.percentage}%)</span>
                  </span>
                </div>
              ))}
              {breakdown.byAccount.length === 0 && (
                <p className="text-sm text-gray-400 dark:text-slate-500">暂无数据</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
