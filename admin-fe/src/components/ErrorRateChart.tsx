import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import type { TimeSeriesBucket } from '@/types';
import { cardClass, chartEmptyStateClass } from '@/lib/styles';
import { useTheme } from '@/contexts/ThemeContext';
import { formatClockTime, roundTo } from '@/lib/time';

interface Props {
  buckets: TimeSeriesBucket[];
}

const ALERT_THRESHOLD = 5;

export default function ErrorRateChart({ buckets }: Props) {
  const { isDark } = useTheme();

  const data = buckets.map((b) => ({
    time: formatClockTime(b.timestamp),
    错误率: b.requestCount > 0 ? roundTo((b.errorCount / b.requestCount) * 100) : 0,
  }));

  const gridStroke = isDark ? '#334155' : '#f0f0f0';
  const tickFill = isDark ? '#94a3b8' : undefined;
  const tooltipBg = isDark ? '#1e293b' : '#fff';
  const tooltipBorder = isDark ? '#334155' : '#e5e7eb';

  if (data.length === 0) {
    return (
      <div className={`${cardClass} p-4`}>
        <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300">错误率趋势</h3>
        <div className={chartEmptyStateClass}>
          暂无数据
        </div>
      </div>
    );
  }

  return (
    <div className={`${cardClass} p-4`}>
      <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300">
        错误率趋势
        <span className="ml-2 text-xs font-normal text-gray-400 dark:text-slate-500">
          阈值 {ALERT_THRESHOLD}%
        </span>
      </h3>
      <div className="mt-3 h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
            <XAxis dataKey="time" tick={{ fontSize: 11, fill: tickFill }} />
            <YAxis tick={{ fontSize: 11, fill: tickFill }} unit="%" domain={[0, 'auto']} />
            <Tooltip
              contentStyle={{
                backgroundColor: tooltipBg,
                borderColor: tooltipBorder,
                borderRadius: 8,
              }}
              formatter={(value) => [`${value}%`, '错误率']}
            />
            <ReferenceLine
              y={ALERT_THRESHOLD}
              stroke="#ef4444"
              strokeDasharray="6 3"
              strokeWidth={1.5}
            />
            <Line
              type="monotone"
              dataKey="错误率"
              stroke="#f97316"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
