import type { ReactNode } from 'react';
import type { Account, QuotaInfo } from '@/types';
import { relativeTime } from '@/lib/time';
import { copyToClipboard } from '@/lib/clipboard';
import { getAccountStatus, formatResetsIn, quotaBarColor } from '@/lib/account-utils';
import { iconButtonClass, secondaryBtnClass } from '@/lib/styles';
import { useToast } from '@/contexts/ToastContext';
import { CopyIcon } from './icons';
import BaseModal from './BaseModal';

interface Props {
  account: Account;
  quota: QuotaInfo | null;
  onClose: () => void;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <span className="w-20 shrink-0 text-xs font-medium text-gray-400 dark:text-slate-500">{label}</span>
      <span className="min-w-0 text-sm text-gray-800 dark:text-slate-200">{children}</span>
    </div>
  );
}

function QuotaRow({ label, pct, resetsAt }: { label: string; pct: number; resetsAt: number }) {
  const clamped = Math.min(100, Math.max(0, pct));
  const remainingPct = 100 - clamped;
  return (
    <div className="flex items-center gap-2">
      <span className="w-6 shrink-0 text-xs font-medium text-gray-500 dark:text-slate-400">{label}</span>
      <div className="relative h-2 w-28 overflow-hidden rounded-full bg-gray-100 dark:bg-slate-700">
        <div
          className={`absolute inset-y-0 left-0 rounded-full transition-all ${quotaBarColor(remainingPct)}`}
          style={{ width: `${remainingPct}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-gray-600 dark:text-slate-400">{remainingPct}%</span>
      <span className="text-xs text-gray-400 dark:text-slate-500" title={`重置于 ${new Date(resetsAt * 1000).toLocaleString()}`}>
        ({formatResetsIn(resetsAt)})
      </span>
    </div>
  );
}

export default function AccountDetailModal({ account, quota, onClose }: Props) {
  const { toast } = useToast();
  const status = getAccountStatus(account);

  const handleCopy = async (text: string, label: string) => {
    await copyToClipboard(text);
    toast(`${label} 已复制`, 'success');
  };

  return (
    <BaseModal
      title="账号详情"
      maxWidth="max-w-lg"
      onClose={onClose}
      showCloseButton
      hideHeader
      panelClassName="overflow-hidden p-0"
    >
      <div className="flex items-center justify-between border-b border-gray-100 dark:border-slate-700 px-6 py-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-slate-100">账号详情</h3>
          <div className="mt-1 flex items-center gap-1.5">
            <span className={`inline-block h-2 w-2 rounded-full ${status.dot}`} />
            <span className={`text-xs ${status.text}`}>{status.label}</span>
          </div>
        </div>
      </div>

      <div className="divide-y divide-gray-50 dark:divide-slate-700/50 px-6 py-2">
        <Field label="ID">
          <span className="font-mono text-xs">{account.id}</span>
        </Field>

        <Field label="备注">
          {account.remark || <span className="text-gray-300 dark:text-slate-600">—</span>}
        </Field>

        <Field label="CODEX_HOME">
          <span className="flex items-center gap-1.5">
            <span className="break-all font-mono text-xs">{account.codexHome}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void handleCopy(account.codexHome, 'CODEX_HOME');
              }}
              className={`shrink-0 ${iconButtonClass}`}
              title="复制"
            >
              <CopyIcon />
            </button>
          </span>
        </Field>

        <Field label="并发">
          {account.runtime ? (
            <span className="font-mono text-xs tabular-nums">
              {account.runtime.activeCount} / {account.runtime.maxConcurrency}
            </span>
          ) : (
            <span className="text-gray-300 dark:text-slate-600">—</span>
          )}
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
            <span className="text-xs text-gray-400 dark:text-slate-500">未查询</span>
          )}
        </Field>
      </div>

      <div className="flex justify-end border-t border-gray-100 dark:border-slate-700 px-6 py-4">
        <button type="button" onClick={onClose} className={secondaryBtnClass}>
          关闭
        </button>
      </div>
    </BaseModal>
  );
}
