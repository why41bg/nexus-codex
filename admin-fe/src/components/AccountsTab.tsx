import { useState } from 'react';
import type { Account } from '@/types';
import { secondaryBtnClass } from '@/lib/styles';
import { useExportAccounts, useBackup } from '@/hooks/useAdminMutations';
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
  const [showImport, setShowImport] = useState(false);

  const exportMutation = useExportAccounts();
  const backupMutation = useBackup();

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
              onClick={() => exportMutation.mutate()}
              disabled={exportMutation.isPending || accounts.length === 0}
              className={`${secondaryBtnClass} disabled:opacity-50`}
            >
              {exportMutation.isPending ? '导出中...' : '导出账号'}
            </button>
            <button
              onClick={() => backupMutation.mutate()}
              disabled={backupMutation.isPending}
              className={secondaryBtnClass}
            >
              {backupMutation.isPending ? '备份中...' : '下载备份'}
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
