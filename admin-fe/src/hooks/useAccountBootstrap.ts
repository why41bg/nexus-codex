import { useState, useCallback, useRef, useEffect } from 'react';
import { api, extractErrorMessage } from '@/lib/api';

interface BootstrapSession {
  sessionId: string;
  codexHome: string;
  loginUrl: string | null;
  deviceCode: string | null;
  status: 'waiting_for_login' | 'success' | 'failed' | 'timeout';
  error: string | null;
  expiresAt: number;
}

interface BootstrapState {
  step: 'form' | 'waiting' | 'success' | 'failed' | 'timeout';
  session: BootstrapSession | null;
  error: string | null;
  remainingSeconds: number;
}

const POLL_INTERVAL_MS = 2000;

export function useAccountBootstrap(onSuccess: () => void) {
  const [state, setState] = useState<BootstrapState>({
    step: 'form',
    session: null,
    error: null,
    remainingSeconds: 0,
  });
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimers = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  }, []);

  const startPolling = useCallback(
    (sessionId: string, expiresAt: number) => {
      // Countdown timer
      countdownRef.current = setInterval(() => {
        const remaining = Math.max(0, Math.ceil((expiresAt * 1000 - Date.now()) / 1000));
        setState((prev) => ({ ...prev, remainingSeconds: remaining }));
      }, 1000);

      // Status polling
      pollTimerRef.current = setInterval(async () => {
        const res = await api<BootstrapSession>(
          'GET',
          `/api/admin/accounts/bootstrap/${sessionId}`,
        );
        if (!res.ok) return;

        const session = res.data;
        if (session.status === 'success') {
          clearTimers();
          setState({ step: 'success', session, error: null, remainingSeconds: 0 });
        } else if (session.status === 'failed') {
          clearTimers();
          setState({
            step: 'failed',
            session,
            error: session.error,
            remainingSeconds: 0,
          });
        } else if (session.status === 'timeout') {
          clearTimers();
          setState({
            step: 'timeout',
            session,
            error: '登录超时（5分钟）',
            remainingSeconds: 0,
          });
        } else {
          setState((prev) => ({ ...prev, session }));
        }
      }, POLL_INTERVAL_MS);
    },
    [clearTimers],
  );

  const startBootstrap = useCallback(
    async (remark: string, maxConcurrency: string) => {
      setState({ step: 'waiting', session: null, error: null, remainingSeconds: 0 });

      const res = await api<BootstrapSession>('POST', '/api/admin/accounts/bootstrap', {
        remark: remark.trim(),
        ...(maxConcurrency ? { maxConcurrency: Number(maxConcurrency) } : {}),
      });

      if (!res.ok) {
        setState({
          step: 'failed',
          session: null,
          error: extractErrorMessage(res.data, '创建失败'),
          remainingSeconds: 0,
        });
        return;
      }

      const session = res.data;
      setState({
        step: 'waiting',
        session,
        error: null,
        remainingSeconds: Math.max(
          0,
          Math.ceil((session.expiresAt * 1000 - Date.now()) / 1000),
        ),
      });
      startPolling(session.sessionId, session.expiresAt);
    },
    [startPolling],
  );

  const confirmBootstrap = useCallback(async () => {
    if (!state.session) return;
    const res = await api(
      'POST',
      `/api/admin/accounts/bootstrap/${state.session.sessionId}/confirm`,
    );
    if (res.ok) {
      clearTimers();
      setState({ step: 'form', session: null, error: null, remainingSeconds: 0 });
      onSuccess();
    }
  }, [state.session, clearTimers, onSuccess]);

  const cancelBootstrap = useCallback(async () => {
    if (!state.session) return;
    await api(
      'POST',
      `/api/admin/accounts/bootstrap/${state.session.sessionId}/cancel`,
    );
    clearTimers();
    setState({ step: 'form', session: null, error: null, remainingSeconds: 0 });
  }, [state.session, clearTimers]);

  const reset = useCallback(() => {
    clearTimers();
    setState({ step: 'form', session: null, error: null, remainingSeconds: 0 });
  }, [clearTimers]);

  useEffect(() => {
    return clearTimers;
  }, [clearTimers]);

  return { state, startBootstrap, confirmBootstrap, cancelBootstrap, reset };
}