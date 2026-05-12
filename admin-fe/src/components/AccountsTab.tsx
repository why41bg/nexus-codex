import { useState, useCallback } from 'react';
import type { Account } from '@/types';
import { api } from '@/lib/api';
import { secondaryBtnClass } from '@/lib/styles';
import { useToast } from '@/contexts/ToastContext';
import { useAuthGuard } from '@/contexts/AuthContext';
import AccountTable from './AccountTable';
import AddAccountForm from './AddAccountForm';
import ImportAccountsModal from './ImportAccountsModal';
import AdminPageHeader from './AdminPageHeader';

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
        toast('导出成功', 'success');
      } else {
        toast('导出失败', 'error');
      }
    } catch {
      toast('请求失败', 'error');
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
        toast('备份下载成功', 'success');
      } else {
        toast('备份失败', 'error');
      }
    } catch {
      toast('请求失败', 'error');
    }
  }, [authGuard, downloadJson, toast]);

  return (
    <div>
      <AdminPageHeader
        title="账号管理"
        description="管理 Codex 账号池中的所有账号"
        actions={
          <>
            <button onClick={() => setShowImport(true)} className={secondaryBtnClass}>
              导入账号
            </button>
            <button
              onClick={handleExport}
              disabled={exporting || accounts.length === 0}
              className={`${secondaryBtnClass} disabled:opacity-50`}
            >
              {exporting ? '导出中...' : '导出账号'}
            </button>
            <button onClick={handleBackup} className={secondaryBtnClass}>
              下载备份
            </button>
          </>
        }
      />

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
