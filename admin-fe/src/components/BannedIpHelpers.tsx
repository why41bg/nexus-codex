import { useState, useRef, useEffect } from 'react';
import { relativeTime } from '@/lib/time';

// ─── Sort types ────────────────────────────────────────────────

export type SortField = 'bannedAt' | 'hitCount';
export type SortDirection = 'asc' | 'desc';

// ─── ReasonCell ────────────────────────────────────────────────

/** 可展开的原因单元格：文本过长时截断，hover 显示完整 Tooltip */
export function ReasonCell({ reason }: { reason: string }) {
  const textRef = useRef<HTMLSpanElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);

  useEffect(() => {
    const el = textRef.current;
    if (el) {
      setIsTruncated(el.scrollWidth > el.clientWidth);
    }
  }, [reason]);

  return (
    <div className="relative max-w-xs group">
      <span
        ref={textRef}
        className="block truncate cursor-default"
        onMouseEnter={() => isTruncated && setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        {reason}
      </span>
      {showTooltip && (
        <div className="absolute left-0 bottom-full mb-2 z-50 max-w-sm w-max rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-gray-700 dark:text-slate-200 shadow-lg whitespace-pre-wrap break-words">
          {reason}
          <div className="absolute left-4 top-full -mt-px w-0 h-0 border-x-[6px] border-x-transparent border-t-[6px] border-t-gray-200 dark:border-t-slate-600" />
          <div className="absolute left-4 top-full -mt-[7px] w-0 h-0 border-x-[6px] border-x-transparent border-t-[6px] border-t-white dark:border-t-slate-800" />
        </div>
      )}
    </div>
  );
}

// ─── TimeCell ──────────────────────────────────────────────────

/** 时间单元格：显示相对时间，hover 显示精确时间 */
export function TimeCell({ iso }: { iso: string | undefined | null }) {
  const [showTooltip, setShowTooltip] = useState(false);

  if (!iso) return <span>-</span>;

  const date = new Date(iso);
  const isValid = !isNaN(date.getTime());
  const precise = isValid
    ? date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : '未知时间';

  return (
    <div className="relative inline-block">
      <span
        className="cursor-default"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        {relativeTime(iso)}
      </span>
      {showTooltip && (
        <div className="absolute left-0 bottom-full mb-2 z-50 w-max rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-gray-700 dark:text-slate-200 shadow-lg whitespace-nowrap">
          {precise}
          <div className="absolute left-4 top-full -mt-px w-0 h-0 border-x-[6px] border-x-transparent border-t-[6px] border-t-gray-200 dark:border-t-slate-600" />
          <div className="absolute left-4 top-full -mt-[7px] w-0 h-0 border-x-[6px] border-x-transparent border-t-[6px] border-t-white dark:border-t-slate-800" />
        </div>
      )}
    </div>
  );
}

// ─── SortIcon ──────────────────────────────────────────────────

export function SortIcon({ field, currentField, currentDir }: { field: SortField; currentField: SortField | null; currentDir: SortDirection }) {
  const isActive = field === currentField;
  return (
    <svg className={`inline-block ml-1 h-3.5 w-3.5 ${isActive ? 'text-brand-600 dark:text-brand-400' : 'text-gray-400 dark:text-slate-500'}`} fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
      {isActive && currentDir === 'asc' ? (
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
      ) : isActive && currentDir === 'desc' ? (
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
      ) : (
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 15 12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9" />
      )}
    </svg>
  );
}
