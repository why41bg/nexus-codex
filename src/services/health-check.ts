import { pool } from './account-pool.js';
import { updateAccount } from './account-store.js';
import { logger } from '../utils/logger.js';

interface HealthCheckOptions {
  /** 检查间隔（毫秒），默认 5 分钟 */
  intervalMs?: number;
  /** 单次探测超时（毫秒），默认 30 秒 */
  timeoutMs?: number;
  /** 连续失败多少次才标记为 unhealthy，默认 2 */
  failThreshold?: number;
}

const DEFAULT_INTERVAL = 5 * 60 * 1000;
const DEFAULT_TIMEOUT = 30 * 1000;
const DEFAULT_FAIL_THRESHOLD = 2;

// 记录每个账号的连续失败次数
const failCounts = new Map<string, number>();

/**
 * 启动定时健康检查。
 * 对每个空闲账号发送轻量探测，根据结果自动标记 healthy/unhealthy。
 */
export function startHealthCheck(options?: HealthCheckOptions): NodeJS.Timeout {
  const intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT;
  const failThreshold = options?.failThreshold ?? DEFAULT_FAIL_THRESHOLD;

  logger.info('Health check started', { intervalSec: intervalMs / 1000, timeoutSec: timeoutMs / 1000, threshold: failThreshold });

  const timer = setInterval(async () => {
    const entries = pool.entries();
    if (entries.length === 0) return;

    for (const entry of entries) {
      // 跳过已满载的账号（所有并发槽位都在使用中）
      if (entry.activeCount >= entry.maxConcurrency) continue;

      const wasHealthy = entry.healthy;

      try {
        const healthy = await probeAccount(entry.codex, timeoutMs);

        if (healthy) {
          // 成功：重置失败计数
          failCounts.set(entry.accountId, 0);

          if (!wasHealthy) {
            // 从 unhealthy 恢复为 healthy
            pool.updateEntry(entry.accountId, { healthy: true });
            await updateAccount(entry.accountId, { healthy: true });
            logger.info('Account recovered to healthy', { accountId: entry.accountId });
          }
        } else {
          // 失败：递增失败计数
          const count = (failCounts.get(entry.accountId) ?? 0) + 1;
          failCounts.set(entry.accountId, count);

          if (count >= failThreshold && wasHealthy) {
            // 连续失败达到阈值，标记为 unhealthy
            pool.updateEntry(entry.accountId, { healthy: false });
            await updateAccount(entry.accountId, { healthy: false });
            logger.warn('Account marked unhealthy', { accountId: entry.accountId, failCount: count });
          }
        }
      } catch (err) {
        // 探测异常也算失败
        const count = (failCounts.get(entry.accountId) ?? 0) + 1;
        failCounts.set(entry.accountId, count);

        if (count >= failThreshold && wasHealthy) {
          pool.updateEntry(entry.accountId, { healthy: false });
          await updateAccount(entry.accountId, { healthy: false });
          const errMsg = err instanceof Error ? err.message : 'Unknown error';
          logger.warn('Account marked unhealthy', { accountId: entry.accountId, error: errMsg });
        }
      }
    }
  }, intervalMs);

  return timer;
}

/**
 * 对单个账号执行一次探测。
 * 启动临时 Thread，发送 "reply with: ok"，检查回复是否包含 "ok"。
 */
async function probeAccount(
  codex: import('@openai/codex-sdk').Codex,
  timeoutMs: number,
): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let thread: import('@openai/codex-sdk').Thread | undefined;
  try {
    thread = codex.startThread({ skipGitRepoCheck: true });
    const turn = await thread.run('reply with: ok', { signal: controller.signal });
    const response = turn.finalResponse ?? '';
    return response.toLowerCase().includes('ok');
  } finally {
    clearTimeout(timeoutId);
    // Note: @openai/codex-sdk Thread 没有 close/destroy 方法，
    // 底层 CLI 进程由 Codex 实例管理。abort 信号已确保超时时中止操作。
    // 将 thread 引用置空以帮助 GC 回收。
    thread = undefined;
  }
}
