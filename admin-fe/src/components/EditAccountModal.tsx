import { useState } from 'react';
import type { Account } from '@/types';
import { inputClass, primaryBtnClass, secondaryBtnClass } from '@/lib/styles';
import { useToast } from '@/contexts/ToastContext';
import { useUpdateAccount } from '@/hooks/useAdminMutations';
import Spinner from './Spinner';
import BaseModal from './BaseModal';

interface Props {
  account: Account;
  onSaved: () => void;
  onCancel: () => void;
}

export default function EditAccountModal({ account, onSaved, onCancel }: Props) {
  const { toast } = useToast();
  const [remark, setRemark] = useState(account.remark ?? '');
  const [maxConcurrency, setMaxConcurrency] = useState(account.runtime?.maxConcurrency?.toString() ?? '');
  const updateAccountMutation = useUpdateAccount();

  const handleSave = () => {
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
    <BaseModal
      title="编辑账号"
      description={`${account.id}${account.codexHome ? ` (${account.codexHome})` : ''}`}
      maxWidth="max-w-md"
      onClose={onCancel}
    >
      <div className="space-y-4">
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
        <button type="button" onClick={onCancel} className={secondaryBtnClass}>
          取消
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={updateAccountMutation.isPending}
          className={primaryBtnClass}
        >
          {updateAccountMutation.isPending && <Spinner className="mr-1.5 inline h-4 w-4" />}
          保存
        </button>
      </div>
    </BaseModal>
  );
}
