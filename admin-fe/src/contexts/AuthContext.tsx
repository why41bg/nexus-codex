import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { api, setAuthToken } from '@/lib/api';

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false);

  const login = useCallback(async (username: string, password: string): Promise<string | null> => {
    const token = btoa(username + ':' + password);
    setAuthToken(token);
    try {
      const res = await api('POST', '/api/admin/login');
      if (res.ok) {
        localStorage.setItem(STORAGE_KEY, token);
        setAuthenticated(true);
        return null; // 无错误
      } else if (res.status === 401) {
        setAuthToken('');
        return '用户名或密码错误';
      } else {
        setAuthToken('');
        return '连接失败，请检查服务是否运行';
      }
    } catch {
      setAuthToken('');
      return '无法连接到服务';
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setAuthToken('');
    setAuthenticated(false);
  }, []);

  const restore = useCallback(async (): Promise<boolean> => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return false;
    setAuthToken(saved);
    try {
      const res = await api('POST', '/api/admin/login');
      if (res.ok) {
        setAuthenticated(true);
        return true;
      }
    } catch {
      // 恢复失败，忽略
    }
    localStorage.removeItem(STORAGE_KEY);
    setAuthToken('');
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
