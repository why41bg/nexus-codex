import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { api, setAuthToken, clearAuthToken } from '@/lib/api';

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

const STORAGE_KEY = 'nexus_admin_token';
const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * 使用 Basic Auth 调用登录接口获取会话令牌
 */
async function loginWithBasicAuth(username: string, password: string): Promise<{ ok: boolean; token?: string }> {
  const basicToken = btoa(username + ':' + password);
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${basicToken}`,
    },
  });
  if (res.ok) {
    const data = await res.json();
    return { ok: true, token: data.token };
  }
  return { ok: false };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false);

  const login = useCallback(async (username: string, password: string): Promise<string | null> => {
    try {
      const result = await loginWithBasicAuth(username, password);
      if (result.ok && result.token) {
        // 存储会话令牌到 sessionStorage（用于 API 请求）和 localStorage（用于跨标签页持久化）
        setAuthToken(result.token);
        localStorage.setItem(STORAGE_KEY, result.token);
        setAuthenticated(true);
        return null; // 无错误
      } else {
        return '用户名或密码错误';
      }
    } catch {
      return '无法连接到服务';
    }
  }, []);

  const logout = useCallback(() => {
    // 调用后端登出接口销毁会话（忽略错误）
    api('POST', '/api/admin/logout').catch(() => {});
    // 清除本地存储的令牌
    localStorage.removeItem(STORAGE_KEY);
    clearAuthToken();
    setAuthenticated(false);
  }, []);

  const restore = useCallback(async (): Promise<boolean> => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return false;

    // 设置令牌到 sessionStorage
    setAuthToken(saved);

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

    // 会话无效，清除本地存储
    localStorage.removeItem(STORAGE_KEY);
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

/** 检测 API 返回 401 后执行登出 */
export function useAuthGuard() {
  const { logout } = useAuth();
  return useCallback(
    (status: number) => {
      if (status === 401) {
        logout();
        return true;
      }
      return false;
    },
    [logout],
  );
}
