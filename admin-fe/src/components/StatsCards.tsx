import type { Dashboard } from '@/types';

interface StatsCardDef {
  label: string;
  value: number | string;
  labelColor: string;
  valueColor: string;
}

function buildCards(d: Dashboard): StatsCardDef[] {
  const slotsLabel = d.totalSlots != null && d.activeSlots != null
    ? `${d.activeSlots} / ${d.totalSlots}`
    : '—';
  return [
    { label: '账号总数', value: d.total ?? '—', labelColor: 'text-gray-500', valueColor: 'text-gray-900' },
    { label: '并发槽位', value: slotsLabel, labelColor: 'text-blue-600', valueColor: 'text-blue-700' },
    { label: '空闲槽位', value: d.availableSlots ?? '—', labelColor: 'text-green-600', valueColor: 'text-green-700' },
    { label: '不健康', value: d.unhealthy ?? '—', labelColor: 'text-red-600', valueColor: 'text-red-700' },
    { label: '已禁用', value: d.disabled ?? '—', labelColor: 'text-gray-400', valueColor: 'text-gray-500' },
    { label: '总请求数', value: d.totalUsage ?? '—', labelColor: 'text-purple-600', valueColor: 'text-purple-700' },
  ];
}

export default function StatsCards({ dashboard }: { dashboard: Dashboard }) {
  const cards = buildCards(dashboard);
  return (
    <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
      {cards.map((card) => (
        <div key={card.label} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
          <p className={`text-xs font-medium uppercase tracking-wider ${card.labelColor}`}>{card.label}</p>
          <p className={`mt-2 text-2xl font-bold ${card.valueColor}`}>{card.value}</p>
        </div>
      ))}
    </div>
  );
}
