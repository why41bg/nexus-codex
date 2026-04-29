import type { Dashboard } from '@/types';
import { cardClass } from '@/lib/styles';

interface StatsCardDef {
  label: string;
  value: number | string;
  labelColor: string;
  valueColor: string;
}

function formatLatency(ms: number | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** 根据内容长度选择合适的数值字号 */
function valueSizeClass(v: string): string {
  const len = v.length;
  if (len <= 3) return 'text-2xl';
  if (len <= 5) return 'text-xl';
  return 'text-lg';
}

function buildCards(d: Dashboard): StatsCardDef[] {
  const slotsLabel = d.totalSlots != null && d.activeSlots != null
    ? `${d.activeSlots}/${d.totalSlots}`
    : '—';
  return [
    { label: '账号总数', value: d.total ?? '—', labelColor: 'text-gray-500 dark:text-slate-400', valueColor: 'text-gray-900 dark:text-slate-100' },
    { label: '并发槽位', value: slotsLabel, labelColor: 'text-blue-600 dark:text-blue-400', valueColor: 'text-blue-700 dark:text-blue-300' },
    { label: '空闲槽位', value: d.availableSlots ?? '—', labelColor: 'text-green-600 dark:text-green-400', valueColor: 'text-green-700 dark:text-green-300' },
    { label: '不健康', value: d.unhealthy ?? '—', labelColor: 'text-red-600 dark:text-red-400', valueColor: 'text-red-700 dark:text-red-300' },
    { label: '已禁用', value: d.disabled ?? '—', labelColor: 'text-gray-400 dark:text-slate-500', valueColor: 'text-gray-500 dark:text-slate-400' },
    { label: '总请求数', value: d.totalUsage ?? '—', labelColor: 'text-purple-600 dark:text-purple-400', valueColor: 'text-purple-700 dark:text-purple-300' },
    { label: '1h 请求数', value: d.recentRequests1h ?? '—', labelColor: 'text-indigo-600 dark:text-indigo-400', valueColor: 'text-indigo-700 dark:text-indigo-300' },
    { label: '1h 错误数', value: d.recentErrors1h ?? '—', labelColor: 'text-orange-600 dark:text-orange-400', valueColor: 'text-orange-700 dark:text-orange-300' },
    { label: '1h 平均延迟', value: formatLatency(d.avgLatency1h), labelColor: 'text-teal-600 dark:text-teal-400', valueColor: 'text-teal-700 dark:text-teal-300' },
  ];
}

export default function StatsCards({ dashboard }: { dashboard: Dashboard }) {
  const cards = buildCards(dashboard);
  return (
    <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-9">
      {cards.map((card) => {
        const valStr = String(card.value);
        return (
          <div key={card.label} className={`${cardClass} min-w-0 overflow-hidden p-4`}>
            <p className={`whitespace-nowrap text-xs font-medium uppercase tracking-wider ${card.labelColor}`}>{card.label}</p>
            <p
              className={`mt-2 whitespace-nowrap font-bold ${card.valueColor} ${valueSizeClass(valStr)}`}
              title={valStr}
            >
              {card.value}
            </p>
          </div>
        );
      })}
    </div>
  );
}
