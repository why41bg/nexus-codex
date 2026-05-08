import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import type { TimeSeriesBucket, PercentileResponse } from '@/types';
import { cardClass } from '@/lib/styles';
import { useTheme } from '@/contexts/ThemeContext';

interface Props {
  buckets: TimeSeriesBucket[];
  percentiles: PercentileResponse | null;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function LatencyChart({ buckets, percentiles }: Props) {
  const { isDark } = useTheme();

  const data = buckets.map((b) => ({
    time: formatTime(b.timestamp),
    平均延迟: b.avgLatencyMs,
  }));

  const gridStroke = isDark ? '#334155' : '#f0f0f0';
  const tickFill = isDark ? '#94a3b8' : undefined;
  const tooltipBg = isDark ? '#1e293b' : '#fff';
  const tooltipBorder = isDark ? '#334155' : '#e5e7eb';

  if (data.length === 0) {
    return (
      <div className={`${cardClass} p-4`}>
        <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300">延迟趋势</h3>
        <div className="flex h-48 items-center justify-center text-sm text-gray-400 dark:text-slate-500">
          暂无数据
        </div>
      </div>
    );
  }

  return (
    <div className={`${cardClass} p-4`}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300">延迟趋势</h3>
        {percentiles && percentiles.sampleCount > 0 && (
          <div className="flex gap-3 text-xs text-gray-500 dark:text-slate-400">
            <span>
              P50: <span className="font-semibold text-gray-700 dark:text-slate-300">{percentiles.p50}ms</span>
            </span>
            <span>
              P95: <span className="font-semibold text-gray-700 dark:text-slate-300">{percentiles.p95}ms</span>
            </span>
            <span>
              P99: <span className="font-semibold text-gray-700 dark:text-slate-300">{percentiles.p99}ms</span>
            </span>
          </div>
        )}
      </div>
      <div className="mt-3 h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
            <XAxis dataKey="time" tick={{ fontSize: 11, fill: tickFill }} />
            <YAxis tick={{ fontSize: 11, fill: tickFill }} unit="ms" />
            <Tooltip
              contentStyle={{
                backgroundColor: tooltipBg,
                borderColor: tooltipBorder,
                borderRadius: 8,
              }}
              formatter={(value) => [`${value}ms`, '平均延迟']}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line
              type="monotone"
              dataKey="平均延迟"
              stroke="#14b8a6"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
