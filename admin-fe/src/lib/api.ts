/**
 * 带 Bearer Token 的 API 请求工具
 *
 * 会话令牌存储在 localStorage 中用于跨标签页持久化，
 * 登出时清除。令牌通过 Bearer header 发送，避免 CSRF 风险。
 *
 * 通过环境变量 VITE_API_BASE 配置后端地址，支持前后端分离部署。
 * 开发时留空即可（Vite 代理会转发请求）。
 */

/** 后端 API 基础地址，生产环境设为后端完整 URL，如 https://api.example.com */
export const API_BASE = import.meta.env.VITE_API_BASE ?? '';

const STORAGE_KEY = 'nexus_admin_token';

export function setAuthToken(token: string) {
  localStorage.setItem(STORAGE_KEY, token);
}

export function getAuthToken(): string {
  return localStorage.getItem(STORAGE_KEY) || '';
}

export function clearAuthToken() {
  localStorage.removeItem(STORAGE_KEY);
}

export async function api<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: T }> {
  const headers: Record<string, string> = {};
  const token = getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const opts: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(`${API_BASE}${path}`, opts);
  let data: T;
  try {
    data = (await res.json()) as T;
  } catch {
    data = null as T;
  }

  return { ok: res.ok, status: res.status, data };
}

/**
 * 从 API 错误响应中提取错误消息。
 * 兼容 OpenAI 风格的 { error: { message: string } } 格式。
 */
export function extractErrorMessage(data: unknown, fallback = '操作失败'): string {
  if (data && typeof data === 'object' && 'error' in data) {
    const err = (data as { error?: { message?: string } }).error;
    if (err?.message) return err.message;
  }
  return fallback;
}
