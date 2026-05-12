/**
 * SSE 实时推送 Hook。
 * 根据事件类型精准 invalidate 对应的 query key。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getAuthToken, API_BASE } from '@/lib/api';
import { queryKeys } from './useAdminQueries';

export function useSSE() {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const connectedRef = useRef(false);

  const updateConnected = useCallback((value: boolean) => {
    connectedRef.current = value;
    setConnected(value);
  }, []);

  useEffect(() => {
    const MAX_RETRIES = 10;
    const MAX_RETRY_DELAY = 60_000;

    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = 1000;
    let retryCount = 0;
    let destroyed = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    function invalidateByEventType(type: string) {
      switch (type) {
        case 'pool_changed':
          queryClient.invalidateQueries({ queryKey: queryKeys.accounts });
          queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
          break;
        case 'health_changed':
          queryClient.invalidateQueries({ queryKey: queryKeys.accounts });
          queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
          break;
        case 'banned_ips_changed':
          queryClient.invalidateQueries({ queryKey: queryKeys.bannedIps });
          break;
        default:
          // 未知事件类型，刷新 dashboard
          queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
      }
    }

    function connect() {
      if (destroyed) return;

      const token = getAuthToken();
      const url = `${API_BASE}/api/admin/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`;
      es = new EventSource(url);

      es.onopen = () => {
        updateConnected(true);
        retryDelay = 1000;
        retryCount = 0;
      };

      es.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data) as { type: string };
          // Debounce 500ms to batch rapid events
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            invalidateByEventType(event.type);
            debounceTimer = null;
          }, 500);
        } catch {
          // ignore parse errors
        }
      };

      es.onerror = () => {
        updateConnected(false);
        es?.close();
        es = null;
        if (!destroyed && retryCount < MAX_RETRIES) {
          retryCount++;
          retryTimer = setTimeout(() => {
            retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY);
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
      updateConnected(false);
    };
  }, [queryClient, updateConnected]);

  return { connected };
}
