/**
 * 带 Bearer Token 的 API 请求工具
 *
 * 会话令牌存储在 sessionStorage 中，避免 XSS 攻击窃取长期凭证。
 */

const SESSION_KEY = 'nexus_session_token';

export function setAuthToken(token: string) {
  sessionStorage.setItem(SESSION_KEY, token);
}

export function getAuthToken(): string {
  return sessionStorage.getItem(SESSION_KEY) || '';
}

export function clearAuthToken() {
  sessionStorage.removeItem(SESSION_KEY);
}

export async function api<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: T }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const opts: RequestInit = { method, headers };
  if (body) {
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(path, opts);
  let data: T;
  try {
    data = await res.json();
  } catch {
    data = {} as T;
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
