import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import type { TimeSeriesBucket } from '@/types';
import { cardClass } from '@/lib/styles';
import { useTheme } from '@/contexts/ThemeContext';

interface Props {
  buckets: TimeSeriesBucket[];
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function RequestTrendChart({ buckets }: Props) {
  const { isDark } = useTheme();

  const data = buckets.map((b) => ({
    time: formatTime(b.timestamp),
    请求数: b.requestCount,
  }));

  const gridStroke = isDark ? '#334155' : '#f0f0f0';
  const tickFill = isDark ? '#94a3b8' : undefined;
  const tooltipBg = isDark ? '#1e293b' : '#fff';
  const tooltipBorder = isDark ? '#334155' : '#e5e7eb';

  if (data.length === 0) {
    return (
      <div className={`${cardClass} p-4`}>
        <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300">请求量趋势</h3>
        <div className="flex h-48 items-center justify-center text-sm text-gray-400 dark:text-slate-500">
          暂无数据
        </div>
      </div>
    );
  }

  return (
    <div className={`${cardClass} p-4`}>
      <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300">请求量趋势</h3>
      <div className="mt-3 h-48">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="requestFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
            <XAxis dataKey="time" tick={{ fontSize: 11, fill: tickFill }} />
            <YAxis tick={{ fontSize: 11, fill: tickFill }} allowDecimals={false} />
            <Tooltip
              contentStyle={{
                backgroundColor: tooltipBg,
                borderColor: tooltipBorder,
                borderRadius: 8,
              }}
            />
            <Area
              type="monotone"
              dataKey="请求数"
              stroke="#6366f1"
              fill="url(#requestFill)"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
