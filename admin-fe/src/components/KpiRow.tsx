import type { Dashboard, SummaryResponse } from '@/types';
import { cardClass } from '@/lib/styles';

interface KpiDef {
  label: string;
  value: string;
  change: number | null;
  /** true = 上升是好事（如成功率），false = 上升是坏事（如错误率/延迟） */
  upIsGood: boolean;
  alert: boolean;
}

function formatLatency(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function ChangeArrow({ change, upIsGood }: { change: number | null; upIsGood: boolean }) {
  if (change == null) return <span className="text-xs text-gray-400 dark:text-slate-500">—</span>;

  const isPositive = change > 0;
  const isGood = upIsGood ? isPositive : !isPositive;
  const color = isGood
    ? 'text-green-600 dark:text-green-400'
    : 'text-red-600 dark:text-red-400';
  const arrow = isPositive ? '↑' : '↓';
  const absVal = Math.abs(change);

  return (
    <span className={`text-xs font-medium ${color}`}>
      {arrow} {absVal}%
    </span>
  );
}

function buildKpis(dashboard: Dashboard, summary: SummaryResponse | null): KpiDef[] {
  const cur = summary?.current;
  const chg = summary?.changes;

  const slotsLabel =
    dashboard.totalSlots != null && dashboard.activeSlots != null
      ? `${dashboard.activeSlots}/${dashboard.totalSlots}`
      : '—';

  const unhealthy = dashboard.unhealthy ?? 0;
  const disabled = dashboard.disabled ?? 0;

  return [
    {
      label: '总请求数',
      value: cur ? formatNum(cur.requests) : String(dashboard.totalUsage ?? '—'),
      change: chg?.requests ?? null,
      upIsGood: true,
      alert: false,
    },
    {
      label: '成功率',
      value: cur ? `${cur.successRate}%` : '—',
      change: chg?.successRate ?? null,
      upIsGood: true,
      alert: cur != null && cur.successRate < 95,
    },
    {
      label: 'P95 延迟',
      value: '—',
      change: null,
      upIsGood: false,
      alert: false,
    },
    {
      label: '并发槽位',
      value: slotsLabel,
      change: null,
      upIsGood: true,
      alert: false,
    },
    {
      label: '异常账号',
      value: String(unhealthy + disabled),
      change: null,
      upIsGood: false,
      alert: unhealthy + disabled > 0,
    },
  ];
}

interface Props {
  dashboard: Dashboard;
  summary: SummaryResponse | null;
  percentiles: { p50: number; p95: number; p99: number } | null;
}

export default function KpiRow({ dashboard, summary, percentiles }: Props) {
  const kpis = buildKpis(dashboard, summary);

  // 用实际分位数替换 P95 占位
  if (percentiles) {
    const p95Idx = kpis.findIndex((k) => k.label === 'P95 延迟');
    if (p95Idx >= 0) {
      kpis[p95Idx] = {
        ...kpis[p95Idx],
        value: formatLatency(percentiles.p95),
        change: null,
        alert: percentiles.p95 > 1000,
      };
    }
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
      {kpis.map((kpi) => (
        <div
          key={kpi.label}
          className={`${cardClass} p-4 transition-colors ${
            kpi.alert ? 'ring-2 ring-red-400 dark:ring-red-500' : ''
          }`}
        >
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">
              {kpi.label}
            </p>
            <ChangeArrow change={kpi.change} upIsGood={kpi.upIsGood} />
          </div>
          <p
            className={`mt-2 text-2xl font-bold tabular-nums ${
              kpi.alert
                ? 'text-red-600 dark:text-red-400'
                : 'text-gray-900 dark:text-slate-100'
            }`}
          >
            {kpi.value}
          </p>
        </div>
      ))}
    </div>
  );
}
