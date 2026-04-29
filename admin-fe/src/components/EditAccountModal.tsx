import { useState, useEffect, useRef } from 'react';
import type { Account } from '@/types';
import { api, extractErrorMessage } from '@/lib/api';
import { inputClass, secondaryBtnClass } from '@/lib/styles';
import { useToast } from '@/contexts/ToastContext';
import { useAuthGuard } from '@/contexts/AuthContext';
import Spinner from './Spinner';
import { useFocusTrap } from '../lib/use-focus-trap';

interface Props {
  account: Account;
  onSaved: () => void;
  onCancel: () => void;
}

export default function EditAccountModal({ account, onSaved, onCancel }: Props) {
  const { toast } = useToast();
  const authGuard = useAuthGuard();
  const [remark, setRemark] = useState(account.remark ?? '');
  const [maxConcurrency, setMaxConcurrency] = useState(
    account.runtime?.maxConcurrency?.toString() ?? '',
  );
  const [saving, setSaving] = useState(false);
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
    setSaving(true);
    try {
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
        toast('\u6ca1\u6709\u9700\u8981\u4fdd\u5b58\u7684\u4fee\u6539', 'success');
        onCancel();
        return;
      }
      const res = await api('PATCH', `/api/admin/accounts/${account.id}`, body);
      if (authGuard(res.status)) return;
      if (res.ok) {
        toast('\u8d26\u53f7\u914d\u7f6e\u5df2\u66f4\u65b0', 'success');
        onSaved();
      } else {
        toast(extractErrorMessage(res.data, '\u4fdd\u5b58\u5931\u8d25'), 'error');
      }
    } catch {
      toast('\u8bf7\u6c42\u5931\u8d25', 'error');
    } finally {
      setSaving(false);
    }
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
          \u7f16\u8f91\u8d26\u53f7
        </h3>
        <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
          <span className="font-mono">{account.id}</span>
          {account.codexHome && (
            <span className="ml-2 text-gray-400 dark:text-slate-500">({account.codexHome})</span>
          )}
        </p>

        <div className="mt-5 space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">\u5907\u6ce8</label>
            <input
              type="text"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="email@example.com"
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">\u6700\u5927\u5e76\u53d1\u6570</label>
            <input
              type="number"
              min="1"
              value={maxConcurrency}
              onChange={(e) => setMaxConcurrency(e.target.value)}
              placeholder="\u9ed8\u8ba4"
              className={inputClass}
            />
            <p className="mt-1 text-xs text-gray-400 dark:text-slate-500">
              \u5f53\u524d\u6d3b\u8dc3 {account.runtime?.activeCount ?? 0} \u4e2a\u8bf7\u6c42
            </p>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onCancel} className={secondaryBtnClass}>
            \u53d6\u6d88
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
          >
            {saving && <Spinner className="mr-1.5 inline h-4 w-4" />}
            \u4fdd\u5b58
          </button>
        </div>
      </div>
    </div>
  );
}
