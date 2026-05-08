import { useState, useEffect, useCallback, useRef } from 'react';
import type { Account, Dashboard, ApiKey, BannedIP } from '@/types';
import { api, getAuthToken, API_BASE } from '@/lib/api';
import { useToast } from '@/contexts/ToastContext';
import { useAuthGuard } from '@/contexts/AuthContext';

interface DashboardData {
  dashboard: Dashboard;
  accounts: Account[];
  models: string[];
  apiKeys: ApiKey[];
  bannedIps: BannedIP[];
}

export function useDashboardData() {
  const { toast } = useToast();
  const authGuard = useAuthGuard();

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<DashboardData>({
    dashboard: {},
    accounts: [],
    models: [],
    apiKeys: [],
    bannedIps: [],
  });
  const [connected, setConnected] = useState(false);

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

      setData({
        dashboard: dashRes.ok ? dashRes.data : data.dashboard,
        accounts: accRes.ok ? (accRes.data.accounts || []) : data.accounts,
        models: modelsRes.ok ? (modelsRes.data.models || []) : data.models,
        apiKeys: keysRes.ok ? (keysRes.data.keys || []) : data.apiKeys,
        bannedIps: bannedRes.ok ? (bannedRes.data.bannedIps || []) : data.bannedIps,
      });
    } catch {
      toast('数据加载失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [authGuard, toast]);

  // Keep ref in sync
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  // Initial load
  useEffect(() => {
    refresh();
  }, [refresh]);

  // SSE connection
  useEffect(() => {
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = 1000;
    let destroyed = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (destroyed) return;

      const token = getAuthToken();
      const url = `${API_BASE}/api/admin/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`;
      es = new EventSource(url);

      es.onopen = () => {
        setConnected(true);
        retryDelay = 1000;
      };

      es.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data) as { type: string };
          if (event.type === 'pool_changed' || event.type === 'health_changed' || event.type === 'banned_ips_changed') {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
              refreshRef.current();
              debounceTimer = null;
            }, 500);
          }
        } catch {
          // ignore parse errors
        }
      };

      es.onerror = () => {
        setConnected(false);
        es?.close();
        es = null;
        if (!destroyed) {
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
  }, []);

  return { data, loading, connected, refresh };
}
