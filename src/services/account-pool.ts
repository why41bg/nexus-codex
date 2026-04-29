import { Codex } from '@openai/codex-sdk';
import type { Account, PoolEntry } from '../types.js';
import { logger } from '../utils/logger.js';
import { emitAdminEvent } from './admin-emitter.js';
import { threadPool } from './thread-pool.js';

/** 默认排队等待超时（毫秒） */
const DEFAULT_ACQUIRE_TIMEOUT_MS = Number(process.env.ACQUIRE_TIMEOUT_MS) || 30_000;

/** 全局默认单账号最大并发数 */
const DEFAULT_MAX_CONCURRENCY = Number(process.env.DEFAULT_MAX_CONCURRENCY) || 1;

/** 等待队列中的一个排队项 */
interface QueueItem {
  resolve: (entry: PoolEntry) => void;
  timer: NodeJS.Timeout;
}

export class AccountPool {
  private pool: PoolEntry[] = [];
  private counter = 0;
  private waitQueue: QueueItem[] = [];

  init(accounts: Account[]): void {
    this.pool = accounts
      .filter((a) => a.enabled)
      .map((a) => ({
        accountId: a.id,
        codexHome: a.codexHome,
        codex: new Codex({ env: { CODEX_HOME: a.codexHome } }),
        activeCount: 0,
        maxConcurrency: a.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY,
        healthy: a.healthy,
      }));
    logger.info('Account pool initialized', { count: this.pool.length, defaultMaxConcurrency: DEFAULT_MAX_CONCURRENCY });
  }

  /**
   * 同步获取一个可用且健康的账号（不排队）。
   * 调度策略：最小负载优先，同负载时轮询作为 tie-breaker。
   * 无可用账号时返回 null。
   */
  acquire(): PoolEntry | null {
    const available = this.pool
      .filter((e) => e.healthy && e.activeCount < e.maxConcurrency)
      .sort((a, b) => a.activeCount - b.activeCount);
    if (available.length === 0) return null;

    // 同负载时用轮询做 tie-breaker
    const minLoad = available[0].activeCount;
    const candidates = available.filter((e) => e.activeCount === minLoad);
    const entry = candidates[this.counter % candidates.length];
    this.counter++;

    entry.activeCount++;
    emitAdminEvent({ type: 'pool_changed' });
    return entry;
  }

  /**
   * 异步获取账号：先尝试同步获取，拿不到则排队等待，超时后返回 null。
   */
  acquireAsync(timeoutMs: number = DEFAULT_ACQUIRE_TIMEOUT_MS): Promise<PoolEntry | null> {
    // 先尝试同步获取
    const entry = this.acquire();
    if (entry) return Promise.resolve(entry);

    // 同步拿不到，进入排队等待
    const position = this.waitQueue.length + 1;
    logger.debug('Queued request', { position, timeoutMs });

    return new Promise<PoolEntry | null>((resolve) => {
      const item: QueueItem = {
        resolve: null!,
        timer: null!,
      };

      item.timer = setTimeout(() => {
        // 超时：从队列中移除，返回 null
        const idx = this.waitQueue.indexOf(item);
        if (idx !== -1) this.waitQueue.splice(idx, 1);
        logger.debug('Queue timeout', { timeoutMs, remainingQueue: this.waitQueue.length });
        resolve(null);
      }, timeoutMs);

      item.resolve = (entry: PoolEntry) => {
        clearTimeout(item.timer);
        logger.debug('Queue fulfilled', { accountId: entry.accountId, remainingQueue: this.waitQueue.length });
        resolve(entry);
      };

      this.waitQueue.push(item);
    });
  }

  /**
   * 释放指定账号的一个并发槽位，并通知队列中的下一个等待者。
   */
  release(accountId: string): void {
    const entry = this.pool.find((e) => e.accountId === accountId);
    if (entry) entry.activeCount = Math.max(0, entry.activeCount - 1);

    emitAdminEvent({ type: 'pool_changed' });

    // 尝试唤醒队列中的下一个等待者
    this.drainQueue();
  }

  /**
   * 从队列头部取出等待者，尝试为其分配账号。
   */
  private drainQueue(): void {
    while (this.waitQueue.length > 0) {
      const entry = this.acquire();
      if (!entry) break; // 没有可用账号了，停止

      const waiter = this.waitQueue.shift()!;
      clearTimeout(waiter.timer);
      waiter.resolve(entry);
    }
  }

  /**
   * 返回当前池中所有条目的状态快照。
   */
  getStatus(): Array<{ accountId: string; activeCount: number; maxConcurrency: number; healthy: boolean }> {
    return this.pool.map((e) => ({
      accountId: e.accountId,
      activeCount: e.activeCount,
      maxConcurrency: e.maxConcurrency,
      healthy: e.healthy,
    }));
  }

  /**
   * 运行时热添加一个账号到池中。
   */
  addEntry(account: Account): void {
    if (this.pool.some((e) => e.accountId === account.id)) return;
    this.pool.push({
      accountId: account.id,
      codexHome: account.codexHome,
      codex: new Codex({ env: { CODEX_HOME: account.codexHome } }),
      activeCount: 0,
      maxConcurrency: account.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY,
      healthy: account.healthy,
    });
    logger.info('Account added to pool', { accountId: account.id, maxConcurrency: account.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY });
  }

  /**
   * 运行时更新池中某个条目的属性（healthy / maxConcurrency 等）。
   */
  updateEntry(accountId: string, partial: Partial<Pick<PoolEntry, 'healthy' | 'maxConcurrency'>>): void {
    const entry = this.pool.find((e) => e.accountId === accountId);
    if (!entry) return;
    if (partial.healthy !== undefined) entry.healthy = partial.healthy;
    if (partial.maxConcurrency !== undefined) entry.maxConcurrency = partial.maxConcurrency;
  }

  /**
   * 运行时从池中移除一个账号，同时驱逐该账号关联的所有 Thread。
   */
  removeEntry(accountId: string): void {
    const index = this.pool.findIndex((e) => e.accountId === accountId);
    if (index !== -1) {
      this.pool.splice(index, 1);
      // 联动清理该账号在 Thread 池中的所有缓存
      threadPool.evict(accountId);
      logger.info('Account removed from pool', { accountId });
    }
  }

  /**
   * 获取池中所有条目（供健康检查等内部模块使用）。
   */
  entries(): PoolEntry[] {
    return this.pool;
  }

}

// 全局单例
export const pool = new AccountPool();
