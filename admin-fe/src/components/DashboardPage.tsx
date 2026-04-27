import { useState, useEffect, useCallback } from 'react';
import type { Account, Dashboard, ApiKey } from '@/types';
import { api } from '@/lib/api';
import { useToast } from '@/contexts/ToastContext';
import { useAuthGuard } from '@/contexts/AuthContext';
import Sidebar, { type TabKey } from './Sidebar';
import DashboardTab from './DashboardTab';
import AccountsTab from './AccountsTab';
import ApiKeysTab from './ApiKeysTab';
import Spinner from './Spinner';

export default function DashboardPage() {
  const { toast } = useToast();
  const authGuard = useAuthGuard();

  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');
  const [loading, setLoading] = useState(false);
  const [dashboard, setDashboard] = useState<Dashboard>({});
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [dashRes, accRes, modelsRes, keysRes] = await Promise.all([
        api<Dashboard>('GET', '/api/admin/dashboard'),
        api<{ accounts: Account[] }>('GET', '/api/admin/accounts'),
        api<{ models: string[] }>('GET', '/api/admin/models'),
        api<{ keys: ApiKey[] }>('GET', '/api/admin/keys'),
      ]);

      if (authGuard(dashRes.status) || authGuard(accRes.status)) return;

      if (dashRes.ok) setDashboard(dashRes.data);
      if (accRes.ok) setAccounts(accRes.data.accounts || []);
      if (modelsRes.ok) setModels(modelsRes.data.models || []);
      if (keysRes.ok) setApiKeys(keysRes.data.keys || []);
    } catch {
      toast('数据加载失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [authGuard, toast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return (
          <DashboardTab
            dashboard={dashboard}
            models={models}
            onModelsChange={setModels}
          />
        );
      case 'accounts':
        return (
          <AccountsTab
            accounts={accounts}
            loading={loading}
            onRefresh={refresh}
          />
        );
      case 'apikeys':
        return (
          <ApiKeysTab
            apiKeys={apiKeys}
            models={models}
            loading={loading}
            onRefresh={refresh}
          />
        );
    }
  };

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 py-8 lg:px-8">
          {/* Top bar with refresh */}
          <div className="mb-6 flex items-center justify-end">
            <button
              onClick={refresh}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50"
            >
              {loading ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
                </svg>
              )}
              刷新
            </button>
          </div>

          {/* Page Content */}
          {renderContent()}
        </div>
      </div>
    </div>
  );
}
