import { useState, useEffect, useRef } from 'react';
import type { Account } from '@/types';
import { api, extractErrorMessage } from '@/lib/api';
import { inputClass } from '@/lib/styles';
import { useToast } from '@/contexts/ToastContext';
import { useAuthGuard } from '@/contexts/AuthContext';
import Spinner from './Spinner';

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

      // 备注：始终提交（允许清空）
      if (remark !== (account.remark ?? '')) {
        body.remark = remark.trim();
      }

      // 并发数：仅在有值且变化时提交
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

      const res = await api('PATCH', `/api/admin/accounts/${account.id}`, body);
      if (authGuard(res.status)) return;
      if (res.ok) {
        toast('账号配置已更新', 'success');
        onSaved();
      } else {
        toast(extractErrorMessage(res.data, '保存失败'), 'error');
      }
    } catch {
      toast('请求失败', 'error');
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
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl ring-1 ring-gray-200 outline-none"
      >
        <h3 id="edit-account-title" className="text-base font-semibold text-gray-900">
          编辑账号
        </h3>
        <p className="mt-1 text-xs text-gray-500">
          <span className="font-mono">{account.id}</span>
          {account.codexHome && (
            <span className="ml-2 text-gray-400">({account.codexHome})</span>
          )}
        </p>

        <div className="mt-5 space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">备注</label>
            <input
              type="text"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="email@example.com"
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">最大并发数</label>
            <input
              type="number"
              min="1"
              value={maxConcurrency}
              onChange={(e) => setMaxConcurrency(e.target.value)}
              placeholder="默认"
              className={inputClass}
            />
            <p className="mt-1 text-xs text-gray-400">
              当前活跃 {account.runtime?.activeCount ?? 0} 个请求
            </p>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
          >
            {saving && <Spinner className="mr-1.5 inline h-4 w-4" />}
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
