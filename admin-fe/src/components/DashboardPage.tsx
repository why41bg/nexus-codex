import { useState } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import Sidebar, { type TabKey } from './Sidebar';
import DashboardTab from './DashboardTab';
import AccountsTab from './AccountsTab';
import ApiKeysTab from './ApiKeysTab';
import BannedIpsTab from './BannedIpsTab';
import TopBar from './TopBar';
import MobileNavbar from './MobileNavbar';
import { useDashboardData } from '@/hooks/useDashboardData';

function getTabFromPath(pathname: string): TabKey {
  if (pathname.includes('/accounts')) return 'accounts';
  if (pathname.includes('/apikeys')) return 'apikeys';
  if (pathname.includes('/banned-ips')) return 'banned-ips';
  return 'dashboard';
}

export default function DashboardPage() {
  const location = useLocation();
  const activeTab = getTabFromPath(location.pathname);
  const { data, loading, connected, refresh } = useDashboardData();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-full">
      <MobileNavbar
        connected={connected}
        loading={loading}
        onRefresh={refresh}
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
          <TopBar connected={connected} loading={loading} onRefresh={refresh} />
          <Routes>
            <Route
              index
              element={<DashboardTab dashboard={data.dashboard} models={data.models} onModelsChange={() => {}} />}
            />
            <Route
              path="accounts"
              element={<AccountsTab accounts={data.accounts} loading={loading} onRefresh={refresh} />}
            />
            <Route
              path="apikeys"
              element={<ApiKeysTab apiKeys={data.apiKeys} models={data.models} loading={loading} onRefresh={refresh} />}
            />
            <Route
              path="banned-ips"
              element={<BannedIpsTab bannedIps={data.bannedIps} loading={loading} onRefresh={refresh} />}
            />
          </Routes>
        </div>
      </div>
    </div>
  );
}
