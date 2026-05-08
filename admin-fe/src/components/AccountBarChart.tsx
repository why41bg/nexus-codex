import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from 'recharts';
import type { MetricsBreakdown } from '@/types';
import { cardClass } from '@/lib/styles';
import { useTheme } from '@/contexts/ThemeContext';

interface Props {
  breakdown: MetricsBreakdown;
}

export default function AccountBarChart({ breakdown }: Props) {
  const { isDark } = useTheme();

  const topAccounts = breakdown.byAccount.slice(0, 10).map((a) => ({
    name: a.accountId.slice(0, 12) + '…',
    fullName: a.accountId,
    count: a.count,
    percentage: a.percentage,
  }));

  const gridStroke = isDark ? '#334155' : '#f0f0f0';
  const tickFill = isDark ? '#94a3b8' : undefined;
  const tooltipBg = isDark ? '#1e293b' : '#fff';
  const tooltipBorder = isDark ? '#334155' : '#e5e7eb';

  if (topAccounts.length === 0) {
    return (
      <div className={`${cardClass} p-4`}>
        <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300">账号使用分布</h3>
        <div className="flex h-48 items-center justify-center text-sm text-gray-400 dark:text-slate-500">
          暂无数据
        </div>
      </div>
    );
  }

  return (
    <div className={`${cardClass} p-4`}>
      <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300">账号使用分布 (24h)</h3>
      <div className="mt-3 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={topAccounts} layout="vertical" margin={{ left: 10, right: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11, fill: tickFill }} />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: 11, fill: tickFill }}
              width={100}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: tooltipBg,
                borderColor: tooltipBorder,
                borderRadius: 8,
              }}
              formatter={(value, _name, props) => [
                `${value} (${(props.payload as { fullName: string; percentage: number }).percentage}%)`,
                (props.payload as { fullName: string; percentage: number }).fullName,
              ]}
              labelFormatter={() => ''}
            />
            <Bar dataKey="count" radius={[0, 4, 4, 0]}>
              {topAccounts.map((_, index) => (
                <Cell
                  key={index}
                  fill={isDark ? '#818cf8' : '#6366f1'}
                  fillOpacity={1 - index * 0.07}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
