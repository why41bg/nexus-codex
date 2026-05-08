import type { Dashboard } from '@/types';
import { cardClass } from '@/lib/styles';
import { slotUsageColor } from '@/lib/account-utils';

interface Props {
  dashboard: Dashboard;
}

export default function HealthBar({ dashboard }: Props) {
  const total = dashboard.totalSlots ?? 0;
  const active = dashboard.activeSlots ?? 0;
  const available = dashboard.availableSlots ?? 0;
  const unhealthy = dashboard.unhealthy ?? 0;
  const disabled = dashboard.disabled ?? 0;
  const healthyActive = Math.max(0, active - unhealthy);

  if (total === 0) {
    return (
      <div className={`${cardClass} p-4`}>
        <p className="text-sm text-gray-400 dark:text-slate-500">暂无槽位数据</p>
      </div>
    );
  }

  const usedPct = (active / total) * 100;
  const remainingPct = (available / total) * 100;

  const segments = [
    { label: '健康在用', value: healthyActive, color: slotUsageColor(usedPct) },
    { label: '异常', value: unhealthy, color: 'bg-red-500' },
    { label: '禁用', value: disabled, color: 'bg-gray-400 dark:bg-slate-500' },
    { label: '空闲', value: available, color: 'bg-blue-300 dark:bg-blue-700' },
  ].filter((s) => s.value > 0);

  return (
    <div className={`${cardClass} p-4`}>
      <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300">账号池槽位</h3>

      {/* 堆叠进度条 + 剩余率 */}
      <div className="mt-3 flex items-center gap-2">
        <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-slate-700">
          {segments.map((seg) => (
            <div
              key={seg.label}
              className={`absolute inset-y-0 transition-all ${seg.color}`}
              style={{
                left: `${segments.slice(0, segments.indexOf(seg)).reduce((sum, s) => sum + (s.value / total) * 100, 0)}%`,
                width: `${(seg.value / total) * 100}%`,
              }}
              title={`${seg.label}: ${seg.value}`}
            />
          ))}
        </div>
        <span className="shrink-0 text-xs tabular-nums text-gray-500 dark:text-slate-400">
          {Math.round(remainingPct)}%
        </span>
        <span className="shrink-0 text-xs tabular-nums text-gray-600 dark:text-slate-300">
          {available}/{total} 空闲
        </span>
      </div>

      {/* 图例 */}
      <div className="mt-3 flex flex-wrap gap-4 text-xs">
        {segments.map((seg) => (
          <div key={seg.label} className="flex items-center gap-1.5">
            <span className={`inline-block h-2.5 w-2.5 rounded-sm ${seg.color}`} />
            <span className="text-gray-600 dark:text-slate-400">{seg.label}</span>
            <span className="font-semibold tabular-nums text-gray-900 dark:text-slate-200">{seg.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
