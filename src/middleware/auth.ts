import type { MiddlewareHandler } from 'hono';
import { getApiKeySet, verifyAdminAuth } from '../services/config-store.js';
import { validateSession } from '../services/session-manager.js';

/**
 * Admin 管理面板鉴权中间件。
 *
 * 支持两种认证方式：
 * 1. Bearer Token: Authorization: Bearer <session_token> (推荐，基于会话)
 * 2. Basic Auth: Authorization: Basic <base64(user:pass)> (向后兼容)
 *
 * Bearer Token 通过 session-manager 验证会话有效性。
 * Basic Auth 校验 data/config.json 中的 adminAuth（username / password）。
 */
export const adminAuthMiddleware: MiddlewareHandler = async (c, next) => {
  // 优先从 query string 读取 token（供 EventSource 等无法设置 header 的场景使用）
  const queryToken = c.req.query('token');
  if (queryToken) {
    if (validateSession(queryToken)) {
      await next();
      return;
    }
    return c.json(
      {
        error: {
          message: 'Invalid or expired session token.',
          type: 'authentication_error',
          code: 'invalid_credentials',
        },
      },
      401,
    );
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader) {
    return c.json(
      {
        error: {
          message: 'Missing Authorization header. Expected: Bearer <token> or Basic <credentials>',
          type: 'authentication_error',
          code: 'missing_credentials',
        },
      },
      401,
    );
  }

  // 尝试 Bearer Token 认证（优先）
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (bearerMatch) {
    const token = bearerMatch[1];
    if (validateSession(token)) {
      await next();
      return;
    }
    return c.json(
      {
        error: {
          message: 'Invalid or expired session token.',
          type: 'authentication_error',
          code: 'invalid_credentials',
        },
      },
      401,
    );
  }

  // 尝试 Basic Auth 认证（向后兼容）
  const basicMatch = authHeader.match(/^Basic\s+(.+)$/i);
  if (!basicMatch) {
    return c.json(
      {
        error: {
          message: 'Invalid Authorization header format. Expected: Bearer <token> or Basic <credentials>',
          type: 'authentication_error',
          code: 'invalid_credentials',
        },
      },
      401,
    );
  }

  let username: string;
  let password: string;
  try {
    const decoded = atob(basicMatch[1]);
    const colonIdx = decoded.indexOf(':');
    if (colonIdx === -1) throw new Error('no colon');
    username = decoded.slice(0, colonIdx);
    password = decoded.slice(colonIdx + 1);
  } catch {
    return c.json(
      {
        error: {
          message: 'Invalid Basic auth encoding.',
          type: 'authentication_error',
          code: 'invalid_credentials',
        },
      },
      401,
    );
  }

  if (!verifyAdminAuth(username, password)) {
    return c.json(
      {
        error: {
          message: 'Invalid username or password.',
          type: 'authentication_error',
          code: 'invalid_credentials',
        },
      },
      401,
    );
  }

  await next();
};

/**
 * API Key 鉴权中间件（用于 /v1/* 路由）。
 *
 * 从 config-store（data/config.json）读取允许的 Key 列表。
 * - 未配置任何 Key 时：返回 401
 * - 已配置 Key 后：Bearer token 校验
 * 校验通过后将当前 API Key 写入 c.set('apiKey', key) 供下游使用。
 */
export const apiKeyAuthMiddleware: MiddlewareHandler = async (c, next) => {
  const allowedKeys = getApiKeySet();

  if (allowedKeys.size === 0) {
    return c.json(
      {
        error: {
          message: 'No API keys configured. Please add at least one API key via the admin panel.',
          type: 'invalid_request_error',
          code: 'no_api_keys',
        },
      },
      401,
    );
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader) {
    return c.json(
      {
        error: {
          message: 'Missing Authorization header. Expected: Bearer <api_key>',
          type: 'invalid_request_error',
          code: 'missing_api_key',
        },
      },
      401,
    );
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return c.json(
      {
        error: {
          message: 'Invalid Authorization header format. Expected: Bearer <api_key>',
          type: 'invalid_request_error',
          code: 'invalid_api_key',
        },
      },
      401,
    );
  }

  const apiKey = match[1];
  if (!allowedKeys.has(apiKey)) {
    return c.json(
      {
        error: {
          message: 'Invalid API key provided.',
          type: 'invalid_request_error',
          code: 'invalid_api_key',
        },
      },
      401,
    );
  }

  // 将当前 API Key 注入上下文，供下游路由使用
  c.set('apiKey', apiKey);

  await next();
};
