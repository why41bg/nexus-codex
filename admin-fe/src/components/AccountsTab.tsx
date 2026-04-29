import { useState, useCallback } from 'react';
import type { Account } from '@/types';
import { api } from '@/lib/api';
import { secondaryBtnClass } from '@/lib/styles';
import { useToast } from '@/contexts/ToastContext';
import { useAuthGuard } from '@/contexts/AuthContext';
import AccountTable from './AccountTable';
import AddAccountForm from './AddAccountForm';
import ImportAccountsModal from './ImportAccountsModal';

interface Props {
  accounts: Account[];
  loading: boolean;
  onRefresh: () => void;
}

export default function AccountsTab({ accounts, loading, onRefresh }: Props) {
  const { toast } = useToast();
  const authGuard = useAuthGuard();
  const [showImport, setShowImport] = useState(false);
  const [exporting, setExporting] = useState(false);

  const downloadJson = useCallback((data: unknown, filename: string) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const res = await api<{ accounts: Account[] }>('GET', '/api/admin/accounts/export');
      if (authGuard(res.status)) return;
      if (res.ok) {
        const date = new Date().toISOString().slice(0, 10);
        downloadJson(res.data, `nexus-codex-accounts-${date}.json`);
        toast('\u5bfc\u51fa\u6210\u529f', 'success');
      } else {
        toast('\u5bfc\u51fa\u5931\u8d25', 'error');
      }
    } catch {
      toast('\u8bf7\u6c42\u5931\u8d25', 'error');
    } finally {
      setExporting(false);
    }
  }, [authGuard, downloadJson, toast]);

  const handleBackup = useCallback(async () => {
    try {
      const res = await api<Record<string, unknown>>('GET', '/api/admin/backup');
      if (authGuard(res.status)) return;
      if (res.ok) {
        const date = new Date().toISOString().slice(0, 10);
        downloadJson(res.data, `nexus-codex-backup-${date}.json`);
        toast('\u5907\u4efd\u4e0b\u8f7d\u6210\u529f', 'success');
      } else {
        toast('\u5907\u4efd\u5931\u8d25', 'error');
      }
    } catch {
      toast('\u8bf7\u6c42\u5931\u8d25', 'error');
    }
  }, [authGuard, downloadJson, toast]);

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">\u8d26\u53f7\u7ba1\u7406</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">\u7ba1\u7406 Codex \u8d26\u53f7\u6c60\u4e2d\u7684\u6240\u6709\u8d26\u53f7</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowImport(true)}
            className={secondaryBtnClass}
          >
            \u5bfc\u5165\u8d26\u53f7
          </button>
          <button
            onClick={handleExport}
            disabled={exporting || accounts.length === 0}
            className={`${secondaryBtnClass} disabled:opacity-50`}
          >
            {exporting ? '\u5bfc\u51fa\u4e2d...' : '\u5bfc\u51fa\u8d26\u53f7'}
          </button>
          <button
            onClick={handleBackup}
            className={secondaryBtnClass}
          >
            \u4e0b\u8f7d\u5907\u4efd
          </button>
        </div>
      </div>

      <AddAccountForm onAdded={onRefresh} />

      <AccountTable accounts={accounts} loading={loading} onRefresh={onRefresh} />

      {showImport && (
        <ImportAccountsModal
          onImported={() => { setShowImport(false); onRefresh(); }}
          onCancel={() => setShowImport(false)}
        />
      )}
    </div>
  );
}
