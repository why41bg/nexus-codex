import { useState, useEffect, useCallback, useRef } from 'react';
import type { Account, Dashboard, ApiKey, BannedIP } from '@/types';
import { api, getAuthToken, API_BASE } from '@/lib/api';
import { useToast } from '@/contexts/ToastContext';
import { useAuthGuard } from '@/contexts/AuthContext';
import Sidebar, { type TabKey } from './Sidebar';
import DashboardTab from './DashboardTab';
import AccountsTab from './AccountsTab';
import ApiKeysTab from './ApiKeysTab';
import BannedIpsTab from './BannedIpsTab';
import Spinner from './Spinner';

function getTabFromHash(): TabKey {
  const hash = window.location.hash.slice(1);
  if (hash === 'accounts' || hash === 'apikeys' || hash === 'banned-ips') return hash;
  return 'dashboard';
}

export default function DashboardPage() {
  const { toast } = useToast();
  const authGuard = useAuthGuard();

  const [activeTab, setActiveTab] = useState<TabKey>(getTabFromHash);

  // URL hash ↔ Tab 状态双向同步
  useEffect(() => {
    const onHashChange = () => setActiveTab(getTabFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const switchTab = useCallback((tab: TabKey) => {
    window.location.hash = tab;
    // hashchange 事件会自动触发 setActiveTab
  }, []);

  const [loading, setLoading] = useState(false);
  const [dashboard, setDashboard] = useState<Dashboard>({});
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [bannedIps, setBannedIps] = useState<BannedIP[]>([]);
  const [connected, setConnected] = useState(false);

  // 用 ref 持有最新的 refresh，避免 SSE 回调闭包捕获旧值
  const refreshRef = useRef<() => Promise<void>>(async () => {});

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [dashRes, accRes, modelsRes, keysRes, bannedRes] = await Promise.all([
        api<Dashboard>('GET', '/api/admin/dashboard'),
        api<{ accounts: Account[] }>('GET', '/api/admin/accounts'),
        api<{ models: string[] }>('GET', '/api/admin/models'),
        api<{ keys: ApiKey[] }>('GET', '/api/admin/keys'),
        api<{ bannedIps: BannedIP[] }>('GET', '/api/admin/banned-ips'),
      ]);

      if (authGuard(dashRes.status) || authGuard(accRes.status)) return;

      if (dashRes.ok) setDashboard(dashRes.data);
      if (accRes.ok) setAccounts(accRes.data.accounts || []);
      if (modelsRes.ok) setModels(modelsRes.data.models || []);
      if (keysRes.ok) setApiKeys(keysRes.data.keys || []);
      if (bannedRes.ok) setBannedIps(bannedRes.data.bannedIps || []);
    } catch {
      toast('数据加载失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [authGuard, toast]);

  // 保持 ref 与最新 refresh 同步
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  // 初始加载
  useEffect(() => {
    refresh();
  }, [refresh]);

  // SSE 长连接：服务端有状态变化时主动推送，前端收到后拉取最新数据
  useEffect(() => {
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = 1000;
    let destroyed = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (destroyed) return;

      // EventSource 不支持自定义 header，通过 query string 传 token
      const token = getAuthToken();
      const url = `${API_BASE}/api/admin/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`;
      es = new EventSource(url);

      es.onopen = () => {
        setConnected(true);
        retryDelay = 1000; // 重连成功后重置退避时间
      };

      es.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data) as { type: string };
          if (event.type === 'pool_changed' || event.type === 'health_changed' || event.type === 'banned_ips_changed') {
            // debounce: 500ms 内合并多次事件，避免请求风暴
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
              refreshRef.current();
              debounceTimer = null;
            }, 500);
          }
        } catch {
          // 忽略解析失败的消息
        }
      };

      es.onerror = () => {
        setConnected(false);
        es?.close();
        es = null;
        if (!destroyed) {
          // 指数退避重连，最长 30 秒
          retryTimer = setTimeout(() => {
            retryDelay = Math.min(retryDelay * 2, 30_000);
            connect();
          }, retryDelay);
        }
      };
    }

    connect();

    return () => {
      destroyed = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (debounceTimer) clearTimeout(debounceTimer);
      es?.close();
      setConnected(false);
    };
  }, []); // 仅挂载时建立一次连接

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
      case 'banned-ips':
        return (
          <BannedIpsTab
            bannedIps={bannedIps}
            loading={loading}
            onRefresh={refresh}
          />
        );
    }
  };

  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-full">
      {/* Mobile Navbar */}
      <div className="fixed top-0 left-0 right-0 z-30 flex items-center justify-between h-14 px-4 bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700 md:hidden">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-lg p-1.5 text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-700"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
          <h1 className="text-base font-bold tracking-tight text-gray-900 dark:text-slate-100">Nexus Codex</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 px-2.5 py-1.5 text-xs text-gray-500 dark:text-slate-400">
            <span className={`h-2 w-2 rounded-full ${connected ? 'bg-green-400' : 'bg-gray-300 dark:bg-slate-500'}`} />
            {connected ? '实时' : '已断开'}
          </div>
          <button
            onClick={refresh}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-2.5 py-1.5 text-xs font-medium text-gray-700 dark:text-slate-300 shadow-sm hover:bg-gray-50 dark:hover:bg-slate-600 disabled:opacity-50"
          >
            {loading ? <Spinner className="h-3.5 w-3.5" /> : (
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
              </svg>
            )}
            刷新
          </button>
        </div>
      </div>

      {/* Desktop Sidebar */}
      <div className="hidden md:block">
        <Sidebar activeTab={activeTab} onTabChange={switchTab} />
      </div>

      {/* Mobile Sidebar Drawer */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSidebarOpen(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-64 bg-white dark:bg-slate-800 shadow-xl">
            <Sidebar
              activeTab={activeTab}
              onTabChange={(tab) => { switchTab(tab); setSidebarOpen(false); }}
            />
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto pt-14 md:pt-0 bg-gray-50 dark:bg-slate-900">
        <div className="mx-auto max-w-5xl px-4 py-6 md:px-6 md:py-8 lg:px-8">
          {/* Top bar — desktop only */}
          <div className="mb-6 hidden items-center justify-end gap-2 md:flex">
            {/* 实时连接状态指示 */}
            <div className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-gray-500 dark:text-slate-400">
              <span className={`h-2 w-2 rounded-full ${connected ? 'bg-green-400' : 'bg-gray-300 dark:bg-slate-500'}`} />
              {connected ? '实时' : '已断开'}
            </div>

            {/* 手动刷新 */}
            <button
              onClick={refresh}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-2 text-sm font-medium text-gray-700 dark:text-slate-300 shadow-sm hover:bg-gray-50 dark:hover:bg-slate-600 disabled:opacity-50"
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
