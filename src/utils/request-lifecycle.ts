/**
 * 请求生命周期管理：封装账号获取、会话创建、超时控制、资源释放等公共逻辑。
 * 供 chat-completions 和 responses 路由共享使用。
 */

import type { Context } from 'hono';
import type { AppEnv, PoolEntry } from '../types.js';
import { pool } from '../services/account-pool.js';
import { createSession, deleteSession, getSessionPoolEntry, type CreateSessionOptions } from '../services/session-store.js';
import { incrementUsageCount } from '../services/account-store.js';
import { isModelAllowedForKey, incrementKeyMonthlyUsage } from '../services/config-store.js';
import { triggerProbe } from '../services/health-check.js';
import { metricsCollector } from '../services/metrics-collector.js';
import { threadPool } from '../services/thread-pool.js';
import { logger, logAcquire, logRelease, logPoolExhausted, type PoolSnapshot } from './logger.js';

/** 由调用方生成池快照，避免 logger.ts 直接导入 pool 产生循环依赖 */
function getPoolSnapshot(): PoolSnapshot {
  const entries = pool.getStatus();
  const totalSlots = entries.reduce((sum, e) => sum + e.maxConcurrency, 0);
  const activeSlots = entries.reduce((sum, e) => sum + e.activeCount, 0);
  return {
    total: entries.length,
    totalSlots,
    activeSlots,
    availableSlots: totalSlots - activeSlots,
    unhealthy: entries.filter((e) => !e.healthy).length,
  };
}

/** 单次请求超时（毫秒），默认 5 分钟 */
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS) || 5 * 60 * 1000;

/**
 * 校验模型是否在当前 API Key 的白名单中。
 * 如果不在白名单中，返回 404 错误响应；否则返回 null。
 */
export function validateModel(c: Context<AppEnv>, model: string): Response | null {
  const apiKey = c.get('apiKey');
  if (!isModelAllowedForKey(apiKey, model)) {
    return c.json(
      {
        error: {
          message: `The model '${model}' does not exist or is not available. Check /v1/models for available models.`,
          type: 'invalid_request_error',
          code: 'model_not_found',
        },
      },
      404,
    );
  }
  return null;
}

/**
 * 从账号池获取一个可用账号。
 * 如果池已耗尽，返回 429 错误响应；否则返回 PoolEntry。
 */
export async function acquireAccount(
  c: Context<AppEnv>,
): Promise<{ entry: PoolEntry } | { error: Response }> {
  const entry = await pool.acquireAsync();
  if (!entry) {
    logPoolExhausted(getPoolSnapshot());
    return {
      error: c.json(
        {
          error: {
            message: 'All account concurrency slots are currently in use. Please try again later.',
            type: 'rate_limit_error',
            code: 'rate_limit_exceeded',
          },
        },
        429,
      ),
    };
  }
  return { entry };
}

export interface RequestContext {
  entry: PoolEntry;
  session: ReturnType<typeof createSession>;
  reqStart: number;
}

/**
 * 初始化请求上下文：获取账号、创建会话、触发使用统计更新。
 */
export function initRequestContext(
  c: Context<AppEnv>,
  entry: PoolEntry,
  sessionOpts: CreateSessionOptions,
): RequestContext {
  const reqStart = Date.now();
  logAcquire(entry.accountId, getPoolSnapshot());

  const session = createSession(entry.accountId, entry.codex, sessionOpts);

  // 异步更新使用统计，不阻塞请求处理
  incrementUsageCount(entry.accountId).catch((err) =>
    logger.error('Failed to update usage stats', { error: err instanceof Error ? err.message : String(err) }),
  );

  // 异步递增 API Key 月配额计数
  const apiKey = c.get('apiKey');
  if (apiKey) {
    incrementKeyMonthlyUsage(apiKey).catch((err) =>
      logger.error('Failed to update key monthly usage', { error: err instanceof Error ? err.message : String(err) }),
    );
  }

  return { entry, session, reqStart };
}

/**
 * 释放请求上下文中的资源（删除会话、记录日志）。
 */
export function releaseRequestContext(ctx: RequestContext, model?: string): void {
  const latencyMs = Date.now() - ctx.reqStart;
  deleteSession(ctx.session.conversationId);
  logRelease(ctx.entry.accountId, latencyMs, getPoolSnapshot());

  // 记录成功请求指标
  metricsCollector.record({
    model: model ?? 'unknown',
    accountId: ctx.entry.accountId,
    latencyMs,
    success: true,
  });
}

/**
 * 在会话尚未创建时释放账号池占用（异常兜底）。
 */
export function releaseAccountOnError(
  entry: PoolEntry,
  reqStart: number,
  err: unknown,
  model?: string,
): void {
  const latencyMs = Date.now() - reqStart;
  pool.release(entry.accountId);
  logRelease(
    entry.accountId,
    latencyMs,
    getPoolSnapshot(),
    err instanceof Error ? err.message : 'unknown error',
  );

  // 记录失败请求指标
  metricsCollector.record({
    model: model ?? 'unknown',
    accountId: entry.accountId,
    latencyMs,
    success: false,
  });

  // 请求失败时立即触发一次本地探测，无需等待定时器
  triggerProbe(entry.accountId).catch((probeErr) =>
    logger.warn('Passive probe failed', {
      accountId: entry.accountId,
      error: probeErr instanceof Error ? probeErr.message : String(probeErr),
    }),
  );
}

/**
 * 在请求失败后驱逐当前会话关联的 Thread（标记为脏，不再复用）。
 * 应在 releaseRequestContext 之前调用。
 */
export function evictSessionThread(conversationId: string): void {
  const poolEntry = getSessionPoolEntry(conversationId);
  if (poolEntry) {
    threadPool.evictEntry(poolEntry);
  }
}

/**
 * 创建带超时的 AbortController。
 * 返回 controller 和清理函数。
 */
export function createTimeoutController(timeoutMs: number = REQUEST_TIMEOUT_MS): {
  controller: AbortController;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return {
    controller,
    cleanup: () => clearTimeout(timeoutId),
  };
}

/**
 * 格式化错误信息，区分超时和其他错误。
 */
export function formatError(err: unknown): { message: string; isTimeout: boolean } {
  const isTimeout = err instanceof Error && err.name === 'AbortError';
  const message = isTimeout
    ? 'Request timed out'
    : err instanceof Error ? err.message : 'Unknown error';
  return { message, isTimeout };
}
