import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import type { MetricsBreakdown } from '@/types';
import { cardClass } from '@/lib/styles';
import { useTheme } from '@/contexts/ThemeContext';

interface Props {
  breakdown: MetricsBreakdown;
}

const COLORS = ['#6366f1', '#14b8a6', '#f97316', '#8b5cf6', '#06b6d4', '#84cc16', '#f43f5e', '#0ea5e9'];

export default function ModelDonut({ breakdown }: Props) {
  const { isDark } = useTheme();

  const topModels = breakdown.byModel.slice(0, 7);
  const otherCount = breakdown.byModel.slice(7).reduce((sum, m) => sum + m.count, 0);

  const pieData = topModels.map((m) => ({
    name: m.model,
    value: m.count,
  }));

  if (otherCount > 0) {
    pieData.push({ name: '其他', value: otherCount });
  }

  const tooltipBg = isDark ? '#1e293b' : '#fff';
  const tooltipBorder = isDark ? '#334155' : '#e5e7eb';

  if (pieData.length === 0) {
    return (
      <div className={`${cardClass} p-4`}>
        <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300">模型分布</h3>
        <div className="flex h-48 items-center justify-center text-sm text-gray-400 dark:text-slate-500">
          暂无数据
        </div>
      </div>
    );
  }

  return (
    <div className={`${cardClass} p-4`}>
      <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300">模型分布 (24h)</h3>
      <div className="mt-3 flex flex-col items-center gap-3 md:flex-row">
        <div className="h-44 w-44 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                innerRadius={40}
                outerRadius={70}
                paddingAngle={2}
                dataKey="value"
              >
                {pieData.map((_, index) => (
                  <Cell key={index} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: tooltipBg,
                  borderColor: tooltipBorder,
                  borderRadius: 8,
                }}
                formatter={(value, name) => [
                  `${value} (${breakdown.totals.requests > 0 ? round((Number(value) / breakdown.totals.requests) * 100) : 0}%)`,
                  name,
                ]}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* 图例列表 */}
        <div className="flex-1 space-y-1.5 text-xs">
          {pieData.map((item, index) => (
            <div key={item.name} className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 truncate">
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: COLORS[index % COLORS.length] }}
                />
                <span className="truncate text-gray-600 dark:text-slate-400" title={item.name}>
                  {item.name}
                </span>
              </div>
              <span className="ml-2 shrink-0 tabular-nums text-gray-900 dark:text-slate-200">
                {item.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
