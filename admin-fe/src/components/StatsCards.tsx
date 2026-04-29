import type { Dashboard } from '@/types';
import { cardClass } from '@/lib/styles';

interface StatsCardDef {
  label: string;
  value: number | string;
  labelColor: string;
  valueColor: string;
}

function formatLatency(ms: number | undefined): string {
  if (ms == null) return '\u2014';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function buildCards(d: Dashboard): StatsCardDef[] {
  const slotsLabel = d.totalSlots != null && d.activeSlots != null
    ? `${d.activeSlots} / ${d.totalSlots}`
    : '\u2014';
  return [
    { label: '\u8d26\u53f7\u603b\u6570', value: d.total ?? '\u2014', labelColor: 'text-gray-500 dark:text-slate-400', valueColor: 'text-gray-900 dark:text-slate-100' },
    { label: '\u5e76\u53d1\u69fd\u4f4d', value: slotsLabel, labelColor: 'text-blue-600 dark:text-blue-400', valueColor: 'text-blue-700 dark:text-blue-300' },
    { label: '\u7a7a\u95f2\u69fd\u4f4d', value: d.availableSlots ?? '\u2014', labelColor: 'text-green-600 dark:text-green-400', valueColor: 'text-green-700 dark:text-green-300' },
    { label: '\u4e0d\u5065\u5eb7', value: d.unhealthy ?? '\u2014', labelColor: 'text-red-600 dark:text-red-400', valueColor: 'text-red-700 dark:text-red-300' },
    { label: '\u5df2\u7981\u7528', value: d.disabled ?? '\u2014', labelColor: 'text-gray-400 dark:text-slate-500', valueColor: 'text-gray-500 dark:text-slate-400' },
    { label: '\u603b\u8bf7\u6c42\u6570', value: d.totalUsage ?? '\u2014', labelColor: 'text-purple-600 dark:text-purple-400', valueColor: 'text-purple-700 dark:text-purple-300' },
    { label: '1h \u8bf7\u6c42\u6570', value: d.recentRequests1h ?? '\u2014', labelColor: 'text-indigo-600 dark:text-indigo-400', valueColor: 'text-indigo-700 dark:text-indigo-300' },
    { label: '1h \u9519\u8bef\u6570', value: d.recentErrors1h ?? '\u2014', labelColor: 'text-orange-600 dark:text-orange-400', valueColor: 'text-orange-700 dark:text-orange-300' },
    { label: '1h \u5e73\u5747\u5ef6\u8fdf', value: formatLatency(d.avgLatency1h), labelColor: 'text-teal-600 dark:text-teal-400', valueColor: 'text-teal-700 dark:text-teal-300' },
  ];
}

export default function StatsCards({ dashboard }: { dashboard: Dashboard }) {
  const cards = buildCards(dashboard);
  return (
    <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-9">
      {cards.map((card) => (
        <div key={card.label} className={`${cardClass} p-4`}>
          <p className={`text-xs font-medium uppercase tracking-wider ${card.labelColor}`}>{card.label}</p>
          <p className={`mt-2 text-2xl font-bold ${card.valueColor}`}>{card.value}</p>
        </div>
      ))}
    </div>
  );
}
