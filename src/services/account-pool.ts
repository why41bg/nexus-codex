import { Codex } from '@openai/codex-sdk';
import type { Account, PoolEntry } from '../types.js';

export class AccountPool {
  private pool: PoolEntry[] = [];
  private counter = 0;

  init(accounts: Account[]): void {
    this.pool = accounts
      .filter((a) => a.enabled)
      .map((a) => ({
        accountId: a.id,
        codex: new Codex({ env: { CODEX_HOME: a.codexHome } }),
        busy: false,
        healthy: a.healthy,
      }));
    console.log(`📦 Account pool initialized with ${this.pool.length} account(s)`);
  }

  /**
   * 轮询选取一个空闲且健康的账号，标记为 busy 并返回。
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
   * 释放指定账号的占用。
   */
  release(accountId: string): void {
    const entry = this.pool.find((e) => e.accountId === accountId);
    if (entry) entry.busy = false;
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
    console.log(`➕ Account ${account.id} added to pool`);
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
      console.log(`➖ Account ${accountId} removed from pool`);
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
