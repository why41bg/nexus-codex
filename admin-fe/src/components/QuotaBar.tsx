import { memo } from 'react';
import { formatResetsIn, quotaBarColor } from '@/lib/account-utils';

interface QuotaBarProps {
  label: string;
  pct: number;
  resetsAt: number;
}

/** 额度进度条 — 显示剩余百分比与重置倒计时 */
const QuotaBar = memo(function QuotaBar({ label, pct, resetsAt }: QuotaBarProps) {
  const clampedPct = Math.min(100, Math.max(0, pct));
  const remainingPct = 100 - clampedPct;
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-5 shrink-0 text-[10px] font-medium text-gray-400 dark:text-slate-500">{label}</span>
      <div className="relative h-1.5 w-20 overflow-hidden rounded-full bg-gray-100 dark:bg-slate-700">
        <div
          className={`absolute inset-y-0 left-0 rounded-full transition-all ${quotaBarColor(remainingPct)}`}
          style={{ width: `${remainingPct}%` }}
        />
      </div>
      <span className="w-8 shrink-0 text-right text-[10px] tabular-nums text-gray-500 dark:text-slate-400">
        {remainingPct}%
      </span>
      <span className="text-[10px] text-gray-400 dark:text-slate-500" title={`重置于 ${new Date(resetsAt * 1000).toLocaleString()}`}>
        {formatResetsIn(resetsAt)}
      </span>
    </div>
  );
});

export default QuotaBar;
