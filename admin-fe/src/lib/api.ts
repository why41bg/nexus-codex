/**
 * 带 Basic Auth 的 API 请求工具
 */

let authToken = '';

export function setAuthToken(token: string) {
  authToken = token;
}

export function getAuthToken(): string {
  return authToken;
}

export async function api<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: T }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authToken) {
    headers['Authorization'] = `Basic ${authToken}`;
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
