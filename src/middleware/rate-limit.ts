import { createMiddleware } from 'hono/factory';
import { findApiKey } from '../services/config-store.js';

/**
 * Rate limit configuration from environment variables.
 */
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX) || 60;
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000; // 1 minute default

/**
 * In-memory store for rate limiting.
 * Maps API key to an array of request timestamps (sliding window).
 */
const requestStore = new Map<string, number[]>();

/**
 * Cleans up expired timestamps from the sliding window.
 */
function cleanupTimestamps(timestamps: number[], windowMs: number): number[] {
  const now = Date.now();
  const cutoff = now - windowMs;
  return timestamps.filter((ts) => ts > cutoff);
}

/**
 * Rate limiting middleware using sliding window algorithm.
 *
 * Limits requests by API Key (from Authorization: Bearer <key> header).
 * Default: 60 requests per minute per API key (configurable via env vars).
 *
 * Response headers:
 * - X-RateLimit-Limit: Maximum requests per window
 * - X-RateLimit-Remaining: Remaining requests in current window
 * - X-RateLimit-Reset: Unix timestamp when the window resets
 *
 * Returns 429 with OpenAI-compatible error format when limit exceeded.
 */
export const rateLimitMiddleware = createMiddleware<{
  Variables: { apiKey?: string };
}>(async (c, next) => {
  // Get API key from context (set by apiKeyAuthMiddleware)
  const apiKey = c.get('apiKey');

  // If no API key in context, skip rate limiting (should not happen after auth middleware)
  if (!apiKey) {
    return next();
  }

  // 读取当前 Key 的独立限流配置，未配置则使用全局默认
  const keyConfig = findApiKey(apiKey);
  const limitMax = keyConfig?.rateLimitMax ?? RATE_LIMIT_MAX;
  const limitWindowMs = keyConfig?.rateLimitWindowMs ?? RATE_LIMIT_WINDOW_MS;

  const now = Date.now();
  const windowStart = now - limitWindowMs;

  // Get or initialize timestamps for this API key
  let timestamps = requestStore.get(apiKey) || [];

  // Clean up expired timestamps
  timestamps = cleanupTimestamps(timestamps, limitWindowMs);

  // 清除不再活跃的 Key 条目，避免内存泄漏
  if (timestamps.length === 0 && requestStore.has(apiKey)) {
    requestStore.delete(apiKey);
  }

  // Calculate remaining requests
  const currentCount = timestamps.length;
  const remaining = Math.max(0, limitMax - currentCount);

  // Calculate reset time (oldest timestamp in window + window duration)
  const oldestTimestamp = timestamps.length > 0 ? Math.min(...timestamps) : now;
  const resetTime = oldestTimestamp + limitWindowMs;

  // Set rate limit headers
  c.header('X-RateLimit-Limit', String(limitMax));
  c.header('X-RateLimit-Remaining', String(remaining));
  c.header('X-RateLimit-Reset', String(Math.ceil(resetTime / 1000))); // Unix timestamp in seconds

  // Check if rate limit exceeded
  if (currentCount >= limitMax) {
    const retryAfterSeconds = Math.ceil((resetTime - now) / 1000);

    return c.json(
      {
        error: {
          message: `Rate limit exceeded. Please retry after ${retryAfterSeconds} seconds.`,
          type: 'rate_limit_error',
          code: 'rate_limit_exceeded',
        },
      },
      429,
    );
  }

  // Record this request
  timestamps.push(now);
  requestStore.set(apiKey, timestamps);

  await next();
});

/**
 * 定期清理不再活跃的 API Key 条目，避免长期运行后内存泄漏。
 * 每 10 分钟扫描一次，删除窗口期内无请求记录的条目。
 */
const CLEANUP_INTERVAL_MS = 10 * 60_000; // 10 minutes

setInterval(() => {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  for (const [key, timestamps] of requestStore) {
    const active = timestamps.filter((ts) => ts > cutoff);
    if (active.length === 0) {
      requestStore.delete(key);
    } else {
      requestStore.set(key, active);
    }
  }
}, CLEANUP_INTERVAL_MS).unref();
