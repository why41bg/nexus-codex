import { useEffect, useRef } from 'react';
import type { Account, QuotaInfo } from '@/types';
import { relativeTime } from '@/lib/time';
import { copyToClipboard } from '@/lib/clipboard';
import { useToast } from '@/contexts/ToastContext';
import { CopyIcon } from './icons';

interface Props {
  account: Account;
  quota: QuotaInfo | null;
  onClose: () => void;
}

function getAccountStatus(acc: Account): { dot: string; text: string; label: string } {
  if (!acc.enabled) return { dot: 'bg-gray-400', text: 'text-gray-400', label: '已禁用' };
  if (!acc.runtime?.healthy) return { dot: 'bg-red-500', text: 'text-red-600', label: '不健康' };
  const active = acc.runtime?.activeCount ?? 0;
  const max = acc.runtime?.maxConcurrency ?? 0;
  if (active >= max) return { dot: 'bg-amber-400', text: 'text-amber-600', label: '满载' };
  if (active > 0) return { dot: 'bg-blue-400', text: 'text-blue-600', label: '部分占用' };
  return { dot: 'bg-green-500', text: 'text-green-600', label: '空闲' };
}

function formatResetsIn(resetsAt: number): string {
  const diffMs = resetsAt * 1000 - Date.now();
  if (diffMs <= 0) return '已重置';
  const totalMins = Math.floor(diffMs / 60_000);
  if (totalMins < 60) return `${totalMins}m`;
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hours < 24) return mins > 0 ? `${hours}h${mins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d${remHours}h` : `${days}d`;
}

function quotaBarColor(pct: number): string {
  if (pct >= 90) return 'bg-red-500';
  if (pct >= 60) return 'bg-amber-400';
  return 'bg-green-500';
}

/** 详情面板中的一行 label-value */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <span className="w-20 shrink-0 text-xs font-medium text-gray-400">{label}</span>
      <span className="min-w-0 text-sm text-gray-800">{children}</span>
    </div>
  );
}

function QuotaRow({ label, pct, resetsAt }: { label: string; pct: number; resetsAt: number }) {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <div className="flex items-center gap-2">
      <span className="w-6 shrink-0 text-xs font-medium text-gray-500">{label}</span>
      <div className="relative h-2 w-28 overflow-hidden rounded-full bg-gray-100">
        <div
          className={`absolute inset-y-0 left-0 rounded-full transition-all ${quotaBarColor(clamped)}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-gray-600">{clamped}%</span>
      <span className="text-xs text-gray-400" title={`重置于 ${new Date(resetsAt * 1000).toLocaleString()}`}>
        ({formatResetsIn(resetsAt)})
      </span>
    </div>
  );
}

export default function AccountDetailModal({ account, quota, onClose }: Props) {
  const { toast } = useToast();
  const dialogRef = useRef<HTMLDivElement>(null);
  const status = getAccountStatus(account);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    dialogRef.current?.focus();
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleCopy = async (text: string, label: string) => {
    await copyToClipboard(text);
    toast(`${label} 已复制`, 'success');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="account-detail-title"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-lg rounded-2xl bg-white shadow-xl ring-1 ring-gray-200 outline-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <h3 id="account-detail-title" className="text-base font-semibold text-gray-900">
              账号详情
            </h3>
            <div className="mt-1 flex items-center gap-1.5">
              <span className={`inline-block h-2 w-2 rounded-full ${status.dot}`} />
              <span className={`text-xs ${status.text}`}>{status.label}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="divide-y divide-gray-50 px-6 py-2">
          <Field label="ID">
            <span className="font-mono text-xs">{account.id}</span>
          </Field>

          <Field label="备注">
            {account.remark || <span className="text-gray-300">—</span>}
          </Field>

          <Field label="CODEX_HOME">
            <span className="flex items-center gap-1.5">
              <span className="break-all font-mono text-xs">{account.codexHome}</span>
              <button
                onClick={(e) => { e.stopPropagation(); handleCopy(account.codexHome, 'CODEX_HOME'); }}
                className="shrink-0 rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                title="复制"
              >
                <CopyIcon />
              </button>
            </span>
          </Field>

          <Field label="并发">
            {account.runtime
              ? <span className="font-mono text-xs tabular-nums">{account.runtime.activeCount} / {account.runtime.maxConcurrency}</span>
              : <span className="text-gray-300">—</span>
            }
          </Field>

          <Field label="使用次数">
            <span className="tabular-nums">{account.usageCount}</span>
          </Field>

          <Field label="最后使用">
            {relativeTime(account.lastUsedAt)}
          </Field>

          <Field label="额度">
            {quota ? (
              <div className="flex flex-col gap-1.5">
                <QuotaRow label="5h" pct={quota.primary.usedPercent} resetsAt={quota.primary.resetsAt} />
                <QuotaRow label="1w" pct={quota.secondary.usedPercent} resetsAt={quota.secondary.resetsAt} />
              </div>
            ) : (
              <span className="text-xs text-gray-400">未查询</span>
            )}
          </Field>
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-gray-100 px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
