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

/** 支持的 HTTP 方法 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** API 返回成功 */
export interface ApiSuccess<T> {
  ok: true;
  status: number;
  data: T;
}

/** API 返回失败 */
export interface ApiFailure {
  ok: false;
  status: number;
  data: unknown;
}

/** API 统一返回类型 */
export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

/**
 * 全局 401 事件监听器列表。
 * 当 API 请求返回 401 时自动调用所有已注册的监听器。
 */
const unauthorizedListeners: Array<() => void> = [];

/** 注册 401 监听器，返回取消注册函数 */
export function onUnauthorized(listener: () => void): () => void {
  unauthorizedListeners.push(listener);
  return () => {
    const idx = unauthorizedListeners.indexOf(listener);
    if (idx >= 0) unauthorizedListeners.splice(idx, 1);
  };
}

function notifyUnauthorized() {
  for (const listener of unauthorizedListeners) {
    listener();
  }
}

export async function api<T = unknown>(
  method: HttpMethod,
  path: string,
  body?: unknown,
  timeoutMs = 30000,
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  const token = getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const opts: RequestInit = { method, headers, signal: controller.signal };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  try {
    const res = await fetch(`${API_BASE}${path}`, opts);

    // 统一 401 拦截
    if (res.status === 401) {
      notifyUnauthorized();
      return { ok: false, status: 401, data: undefined } as ApiFailure;
    }

    let data: unknown;
    try {
      data = await res.json();
    } catch {
      // Response body is not valid JSON (e.g. 204 No Content)
      data = undefined;
    }

    if (res.ok) {
      return { ok: true, status: res.status, data: data as T };
    }
    return { ok: false, status: res.status, data };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
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
