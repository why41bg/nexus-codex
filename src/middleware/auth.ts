import type { MiddlewareHandler } from 'hono';

/**
 * API Key 鉴权中间件。
 *
 * 从环境变量 NEXUS_API_KEYS 读取允许的 Key 列表（逗号分隔）。
 * 如果未配置 NEXUS_API_KEYS，则跳过鉴权（开发模式）。
 * 校验请求头 Authorization: Bearer <key>。
 */
export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const keysEnv = process.env.NEXUS_API_KEYS;

  // 未配置 API Keys 时跳过鉴权（开发模式）
  if (!keysEnv) {
    await next();
    return;
  }

  const allowedKeys = new Set(
    keysEnv
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean),
  );

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

  await next();
};
