import { useState, useEffect, useRef } from 'react';
import type { Account } from '@/types';
import { inputClass, secondaryBtnClass } from '@/lib/styles';
import { useToast } from '@/contexts/ToastContext';
import { useUpdateAccount } from '@/hooks/useAdminMutations';
import Spinner from './Spinner';
import { useFocusTrap } from '../lib/use-focus-trap';

interface Props {
  account: Account;
  onSaved: () => void;
  onCancel: () => void;
}

export default function EditAccountModal({ account, onSaved, onCancel }: Props) {
  const { toast } = useToast();
  const [remark, setRemark] = useState(account.remark ?? '');
  const [maxConcurrency, setMaxConcurrency] = useState(
    account.runtime?.maxConcurrency?.toString() ?? '',
  );
  const updateAccountMutation = useUpdateAccount();
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleKeyDown);
    dialogRef.current?.focus();
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  const handleSave = async () => {
    const body: Record<string, unknown> = {};
    if (remark !== (account.remark ?? '')) {
      body.remark = remark.trim();
    }
    const newConcurrency = maxConcurrency.trim() ? Number(maxConcurrency) : undefined;
    const oldConcurrency = account.runtime?.maxConcurrency;
    if (newConcurrency !== undefined && newConcurrency !== oldConcurrency) {
      body.maxConcurrency = newConcurrency;
    }
    if (Object.keys(body).length === 0) {
      toast('没有需要保存的修改', 'success');
      onCancel();
      return;
    }
    updateAccountMutation.mutate(
      { id: account.id, body },
      { onSuccess: () => onSaved() },
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-account-title"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="mx-4 w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-xl ring-1 ring-gray-200 dark:ring-slate-700 outline-none"
      >
        <h3 id="edit-account-title" className="text-base font-semibold text-gray-900 dark:text-slate-100">
          编辑账号
        </h3>
        <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
          <span className="font-mono">{account.id}</span>
          {account.codexHome && (
            <span className="ml-2 text-gray-400 dark:text-slate-500">({account.codexHome})</span>
          )}
        </p>

        <div className="mt-5 space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">备注</label>
            <input
              type="text"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="email@example.com"
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">最大并发数</label>
            <input
              type="number"
              min="1"
              value={maxConcurrency}
              onChange={(e) => setMaxConcurrency(e.target.value)}
              placeholder="默认"
              className={inputClass}
            />
            <p className="mt-1 text-xs text-gray-400 dark:text-slate-500">
              当前活跃 {account.runtime?.activeCount ?? 0} 个请求
            </p>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onCancel} className={secondaryBtnClass}>
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={updateAccountMutation.isPending}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
          >
            {updateAccountMutation.isPending && <Spinner className="mr-1.5 inline h-4 w-4" />}
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
