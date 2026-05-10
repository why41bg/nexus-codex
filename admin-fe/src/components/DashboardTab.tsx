import { useState, useCallback, useEffect } from 'react';
import type { Dashboard, SummaryResponse, PercentileResponse, PerKeyStats } from '@/types';
import { api } from '@/lib/api';
import { cardClass } from '@/lib/styles';
import StatsCards from './StatsCards';
import MetricsChart from './MetricsChart';
import ModelManager from './ModelManager';

interface Props {
  dashboard: Dashboard;
  models: string[];
  onModelsChange: (models: string[]) => void;
}

function PerKeyMetrics() {
  const [range, setRange] = useState('24h');
  const [data, setData] = useState<PerKeyStats[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    api<{ keys: PerKeyStats[] }>('GET', `/api/admin/metrics/per-key?range=${range}`)
      .then((res) => {
        if (res.ok) setData(res.data.keys);
      })
      .finally(() => setLoading(false));
  }, [range]);

  return (
    <div className={`mt-6 ${cardClass} p-6`}>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Per-Key 使用指标</h3>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">各 API Key 的请求量、错误率和延迟</p>
        </div>
        <select
          value={range}
          onChange={(e) => setRange(e.target.value)}
          className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs text-gray-700 dark:text-slate-300"
        >
          <option value="1h">最近 1 小时</option>
          <option value="6h">最近 6 小时</option>
          <option value="24h">最近 24 小时</option>
          <option value="7d">最近 7 天</option>
        </select>
      </div>

      {loading && <p className="mt-4 text-xs text-gray-400 dark:text-slate-500">加载中...</p>}
      {!loading && data.length === 0 && <p className="mt-4 text-xs text-gray-400 dark:text-slate-500">暂无数据</p>}

      {!loading && data.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-100 dark:border-slate-700 bg-gray-50/60 dark:bg-slate-800/60">
              <tr>
                <th className="px-3 py-2 text-xs font-medium text-gray-500 dark:text-slate-400">Key 前缀</th>
                <th className="px-3 py-2 text-xs font-medium text-gray-500 dark:text-slate-400">请求数</th>
                <th className="px-3 py-2 text-xs font-medium text-gray-500 dark:text-slate-400">错误数</th>
                <th className="px-3 py-2 text-xs font-medium text-gray-500 dark:text-slate-400">错误率</th>
                <th className="px-3 py-2 text-xs font-medium text-gray-500 dark:text-slate-400">平均延迟</th>
                <th className="px-3 py-2 text-xs font-medium text-gray-500 dark:text-slate-400">最后使用</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
              {data.map((row) => (
                <tr key={row.apiKeyPrefix} className="hover:bg-gray-50/50 dark:hover:bg-slate-700/50">
                  <td className="px-3 py-2 font-mono text-xs text-gray-700 dark:text-slate-300">{row.apiKeyPrefix}</td>
                  <td className="px-3 py-2 text-xs text-gray-700 dark:text-slate-300">{row.totalRequests.toLocaleString()}</td>
                  <td className="px-3 py-2 text-xs text-red-600 dark:text-red-400">{row.totalErrors}</td>
                  <td className="px-3 py-2 text-xs">
                    <span className={row.errorRate > 5 ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-600 dark:text-slate-400'}>{row.errorRate}%</span>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-700 dark:text-slate-300">{row.avgLatencyMs} ms</td>
                  <td className="px-3 py-2 text-xs text-gray-500 dark:text-slate-400">{new Date(row.lastUsed).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function DashboardTab({ dashboard, models, onModelsChange }: Props) {
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [percentiles, setPercentiles] = useState<PercentileResponse | null>(null);

  const handleSummaryChange = useCallback((s: SummaryResponse | null) => {
    setSummary(s);
  }, []);

  const handlePercentilesChange = useCallback((p: PercentileResponse | null) => {
    setPercentiles(p);
  }, []);

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">数据大盘</h2>
      <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">查看账号池整体运行状态与模型配置</p>

      <StatsCards dashboard={dashboard} summary={summary} percentiles={percentiles} />

      <MetricsChart
        onSummaryChange={handleSummaryChange}
        onPercentilesChange={handlePercentilesChange}
      />

      <PerKeyMetrics />

      <ModelManager models={models} onModelsChange={onModelsChange} />
    </div>
  );
}
