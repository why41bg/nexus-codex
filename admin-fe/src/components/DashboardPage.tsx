import { useState } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { useIsFetching } from '@tanstack/react-query';
import Sidebar, { type TabKey } from './Sidebar';
import DashboardTab from './DashboardTab';
import AccountsTab from './AccountsTab';
import ApiKeysTab from './ApiKeysTab';
import ContributionsTab from './ContributionsTab';
import BannedIpsTab from './BannedIpsTab';
import LogsTab from './LogsTab';
import SettingsTab from './SettingsTab';
import TopBar from './TopBar';
import MobileNavbar from './MobileNavbar';
import { useSSE } from '@/hooks/useSSE';
import {
  useDashboard,
  useAccounts,
  useModels,
  useApiKeys,
  useApiKeyTemplates,
  useBannedIps,
  useContributionInvites,
  useContributionRecords,
} from '@/hooks/useAdminQueries';

function getTabFromPath(pathname: string): TabKey {
  if (pathname.includes('/accounts')) return 'accounts';
  if (pathname.includes('/apikeys')) return 'apikeys';
  if (pathname.includes('/contributions')) return 'contributions';
  if (pathname.includes('/banned-ips')) return 'banned-ips';
  if (pathname.includes('/logs')) return 'logs';
  if (pathname.includes('/settings')) return 'settings';
  return 'dashboard';
}

export default function DashboardPage() {
  const location = useLocation();
  const activeTab = getTabFromPath(location.pathname);
  const { connected } = useSSE();

  // 各 Tab 按需使用独立 query
  const { data: dashboard, refetch: refetchDashboard } = useDashboard();
  const { data: accounts, refetch: refetchAccounts } = useAccounts();
  const { data: models, refetch: refetchModels } = useModels();
  const { data: apiKeys, refetch: refetchApiKeys } = useApiKeys();
  const { data: templates, refetch: refetchTemplates } = useApiKeyTemplates();
  const { data: bannedIps, refetch: refetchBannedIps } = useBannedIps();
  const { data: invites, refetch: refetchInvites } = useContributionInvites();
  const { data: records, refetch: refetchRecords } = useContributionRecords();

  const isFetching = useIsFetching({ queryKey: ['admin'] }) > 0;

  const refreshAll = async () => {
    await Promise.all([
      refetchDashboard(),
      refetchAccounts(),
      refetchModels(),
      refetchApiKeys(),
      refetchTemplates(),
      refetchBannedIps(),
      refetchInvites(),
      refetchRecords(),
    ]);
  };

  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-full">
      <MobileNavbar
        connected={connected}
        loading={isFetching}
        onRefresh={refreshAll}
        onMenuClick={() => setSidebarOpen(true)}
      />

      <div className="hidden md:block">
        <Sidebar activeTab={activeTab} />
      </div>

      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSidebarOpen(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-64 bg-white dark:bg-slate-800 shadow-xl">
            <Sidebar activeTab={activeTab} onClose={() => setSidebarOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto pt-14 md:pt-0 bg-gray-50 dark:bg-slate-900">
        <div className="mx-auto max-w-5xl px-4 py-6 md:px-6 md:py-8 lg:px-8">
          <TopBar connected={connected} loading={isFetching} onRefresh={refreshAll} />
          <Routes>
            <Route
              index
              element={<DashboardTab dashboard={dashboard ?? ({} as never)} models={models ?? []} />}
            />
            <Route
              path="accounts"
              element={
                <AccountsTab
                  accounts={accounts ?? []}
                  loading={isFetching}
                  onRefresh={async () => { await refetchAccounts(); }}
                />
              }
            />
            <Route
              path="apikeys"
              element={
                <ApiKeysTab
                  apiKeys={apiKeys ?? []}
                  templates={templates ?? []}
                  models={models ?? []}
                  loading={isFetching}
                  onRefresh={async () => { await Promise.all([refetchApiKeys(), refetchTemplates()]); }}
                />
              }
            />
            <Route
              path="contributions"
              element={
                <ContributionsTab
                  invites={invites ?? []}
                  records={records ?? []}
                />
              }
            />
            <Route
              path="banned-ips"
              element={
                <BannedIpsTab
                  bannedIps={bannedIps ?? []}
                  loading={isFetching}
                />
              }
            />
            <Route
              path="logs"
              element={<LogsTab />}
            />
            <Route
              path="settings"
              element={<SettingsTab />}
            />
          </Routes>
        </div>
      </div>
    </div>
  );
}
