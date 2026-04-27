import type { Account } from '@/types';
import AccountTable from './AccountTable';
import AddAccountForm from './AddAccountForm';

interface Props {
  accounts: Account[];
  loading: boolean;
  onRefresh: () => void;
}

export default function AccountsTab({ accounts, loading, onRefresh }: Props) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900">账号管理</h2>
      <p className="mt-1 text-sm text-gray-500">管理 Codex 账号池中的所有账号</p>

      <AccountTable accounts={accounts} loading={loading} onRefresh={onRefresh} />

      <AddAccountForm onAdded={onRefresh} />
    </div>
  );
}
