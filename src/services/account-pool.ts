import { Codex } from '@openai/codex-sdk';
import type { Account, PoolEntry } from '../types.js';
import { logger } from '../utils/logger.js';

/** 默认排队等待超时（毫秒） */
const DEFAULT_ACQUIRE_TIMEOUT_MS = Number(process.env.ACQUIRE_TIMEOUT_MS) || 30_000;

/** 等待队列中的一个排队项 */
interface QueueItem {
  resolve: (entry: PoolEntry) => void;
  reject: (err: Error) => void;
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
        codex: new Codex({ env: { CODEX_HOME: a.codexHome } }),
        busy: false,
        healthy: a.healthy,
      }));
    logger.info('Account pool initialized', { count: this.pool.length });
  }

  /**
   * 同步获取一个空闲且健康的账号（不排队）。
   * 无可用账号时返回 null。
   */
  acquire(): PoolEntry | null {
    const available = this.pool.filter((e) => !e.busy && e.healthy);
    if (available.length === 0) return null;
    const entry = available[this.counter % available.length];
    this.counter++;
    entry.busy = true;
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
    logger.info('Queued request', { position, timeoutMs });

    return new Promise<PoolEntry | null>((resolve) => {
      const item: QueueItem = {
        resolve: null!,
        reject: null!,
        timer: null!,
      };

      item.timer = setTimeout(() => {
        // 超时：从队列中移除，返回 null
        const idx = this.waitQueue.indexOf(item);
        if (idx !== -1) this.waitQueue.splice(idx, 1);
        logger.info('Queue timeout', { timeoutMs, remainingQueue: this.waitQueue.length });
        resolve(null);
      }, timeoutMs);

      item.resolve = (entry: PoolEntry) => {
        clearTimeout(item.timer);
        logger.info('Queue fulfilled', { accountId: entry.accountId, remainingQueue: this.waitQueue.length });
        resolve(entry);
      };

      this.waitQueue.push(item);
    });
  }

  /**
   * 释放指定账号的占用，并通知队列中的下一个等待者。
   */
  release(accountId: string): void {
    const entry = this.pool.find((e) => e.accountId === accountId);
    if (entry) entry.busy = false;

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
  getStatus(): Array<{ accountId: string; busy: boolean; healthy: boolean }> {
    return this.pool.map((e) => ({
      accountId: e.accountId,
      busy: e.busy,
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
      codex: new Codex({ env: { CODEX_HOME: account.codexHome } }),
      busy: false,
      healthy: account.healthy,
    });
    logger.info('Account added to pool', { accountId: account.id });
  }

  /**
   * 运行时更新池中某个条目的属性（healthy / busy 等）。
   */
  updateEntry(accountId: string, partial: Partial<Pick<PoolEntry, 'healthy' | 'busy'>>): void {
    const entry = this.pool.find((e) => e.accountId === accountId);
    if (!entry) return;
    if (partial.healthy !== undefined) entry.healthy = partial.healthy;
    if (partial.busy !== undefined) entry.busy = partial.busy;
  }

  /**
   * 运行时从池中移除一个账号。
   */
  removeEntry(accountId: string): void {
    const index = this.pool.findIndex((e) => e.accountId === accountId);
    if (index !== -1) {
      this.pool.splice(index, 1);
      logger.info('Account removed from pool', { accountId });
    }
  }

  /**
   * 获取池中所有条目（供健康检查等内部模块使用）。
   */
  entries(): PoolEntry[] {
    return this.pool;
  }

  /**
   * 池中账号总数。
   */
  get size(): number {
    return this.pool.length;
  }
}

// 全局单例
export const pool = new AccountPool();
