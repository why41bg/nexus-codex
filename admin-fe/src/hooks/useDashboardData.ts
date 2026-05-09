import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Account, Dashboard, ApiKey, ApiKeyTemplate, BannedIP } from '@/types';
import { api, getAuthToken, API_BASE } from '@/lib/api';

async function fetchDashboardData() {
  const [dashRes, accRes, modelsRes, keysRes, templatesRes, bannedRes] = await Promise.all([
    api<Dashboard>('GET', '/api/admin/dashboard'),
    api<{ accounts: Account[] }>('GET', '/api/admin/accounts'),
    api<{ models: string[] }>('GET', '/api/admin/models'),
    api<{ keys: ApiKey[] }>('GET', '/api/admin/keys'),
    api<{ templates: ApiKeyTemplate[] }>('GET', '/api/admin/key-templates'),
    api<{ bannedIps: BannedIP[] }>('GET', '/api/admin/banned-ips'),
  ]);

  return {
    dashboard: dashRes.ok ? dashRes.data : ({} as Dashboard),
    accounts: accRes.ok ? (accRes.data.accounts || []) : [],
    models: modelsRes.ok ? (modelsRes.data.models || []) : [],
    apiKeys: keysRes.ok ? (keysRes.data.keys || []) : [],
    apiKeyTemplates: templatesRes.ok ? (templatesRes.data.templates || []) : [],
    bannedIps: bannedRes.ok ? (bannedRes.data.bannedIps || []) : [],
  };
}

export function useDashboardData() {
  const queryClient = useQueryClient();

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['dashboardData'],
    queryFn: fetchDashboardData,
    staleTime: 30_000,
  });

  const defaultData = {
    dashboard: {} as Dashboard,
    accounts: [] as Account[],
    models: [] as string[],
    apiKeys: [] as ApiKey[],
    apiKeyTemplates: [] as ApiKeyTemplate[],
    bannedIps: [] as BannedIP[],
  };

  const dashboardData = data ?? defaultData;

  // SSE connection for real-time invalidation
  const connectedRef = useRef(false);

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
        connectedRef.current = true;
        retryDelay = 1000;
      };

      es.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data) as { type: string };
          if (
            event.type === 'pool_changed' ||
            event.type === 'health_changed' ||
            event.type === 'banned_ips_changed'
          ) {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
              queryClient.invalidateQueries({ queryKey: ['dashboardData'] });
              debounceTimer = null;
            }, 500);
          }
        } catch {
          // ignore parse errors
        }
      };

      es.onerror = () => {
        connectedRef.current = false;
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
      connectedRef.current = false;
    };
  }, [queryClient]);

  return {
    data: dashboardData,
    loading: isLoading || isFetching,
    refreshing: isFetching && !isLoading,
    connected: connectedRef.current,
    refresh: async () => { await refetch(); },
  };
}
