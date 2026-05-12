import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { api, setAuthToken, getAuthToken, clearAuthToken, onUnauthorized } from '@/lib/api';

interface AuthContextValue {
  /** 是否已登录 */
  authenticated: boolean;
  /** 登录 */
  login: (username: string, password: string) => Promise<string | null>;
  /** 退出 */
  logout: () => void;
  /** 尝试恢复已保存的登录状态 */
  restore: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false);

  const logout = useCallback(() => {
    // 调用后端登出接口销毁会话（忽略错误）
    api('POST', '/api/admin/logout').catch(() => {});
    clearAuthToken();
    setAuthenticated(false);
  }, []);

  // 注册全局 401 监听器 — API 层返回 401 时自动登出
  useEffect(() => {
    return onUnauthorized(() => {
      clearAuthToken();
      setAuthenticated(false);
    });
  }, []);

  const login = useCallback(async (username: string, password: string): Promise<string | null> => {
    try {
      const res = await api<{ token: string }>('POST', '/api/admin/login', { username, password });
      if (res.ok) {
        setAuthToken(res.data.token);
        setAuthenticated(true);
        return null; // 无错误
      } else {
        return '用户名或密码错误';
      }
    } catch {
      return '无法连接到服务';
    }
  }, []);

  const restore = useCallback(async (): Promise<boolean> => {
    const saved = getAuthToken();
    if (!saved) return false;

    try {
      // 通过调用 dashboard 接口验证会话是否有效
      const res = await api('GET', '/api/admin/dashboard');
      if (res.ok) {
        setAuthenticated(true);
        return true;
      }
    } catch {
      // 恢复失败，忽略
    }

    clearAuthToken();
    return false;
  }, []);

  return (
    <AuthContext.Provider value={{ authenticated, login, logout, restore }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
