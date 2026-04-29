/**
 * Thread 池管理器 — 对同一 (account, model) 组合维护预热好的 Thread 实例，
 * 减少每次请求的冷启动延迟。
 *
 * 核心策略：
 * - 池化粒度为 `${accountId}:${model}`，每个 slot 最多保留 maxIdlePerSlot 个空闲 Thread
 * - Thread 有最大存活时间（maxThreadAgeMs）和最大复用次数（maxUsageCount）
 * - 定时清理超龄 Thread，优雅关闭时驱逐全部
 * - 通过 THREAD_POOL_ENABLED 环境变量做 feature flag，默认关闭
 */

import type { Codex, Thread, ModelReasoningEffort } from '@openai/codex-sdk';
import { logger } from '../utils/logger.js';

// ─── 配置 ────────────────────────────────────────────────────

/** Feature flag：是否启用 Thread 池化，默认 false */
export const THREAD_POOL_ENABLED =
  (process.env.THREAD_POOL_ENABLED ?? 'false').toLowerCase() === 'true';

/** 每个 (account, model) slot 最多保留的空闲 Thread 数 */
const MAX_IDLE_PER_SLOT = Number(process.env.THREAD_POOL_MAX_IDLE) || 2;

/** Thread 最大存活时间（ms），默认 30 分钟 */
const MAX_THREAD_AGE_MS = Number(process.env.THREAD_POOL_MAX_AGE_MS) || 30 * 60 * 1000;

/** 单个 Thread 最大复用次数，默认 50 */
const MAX_USAGE_COUNT = Number(process.env.THREAD_POOL_MAX_USAGE) || 50;

/** 清理扫描间隔（ms），默认 5 分钟 */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

// ─── 类型定义 ────────────────────────────────────────────────

export interface ThreadPoolEntry {
  thread: Thread;
  accountId: string;
  model: string;
  createdAt: number;
  lastUsedAt: number;
  inUse: boolean;
  usageCount: number;
}

export interface ThreadPoolStats {
  /** 池中 Thread 总数 */
  size: number;
  /** 空闲 Thread 数 */
  idle: number;
  /** 正在使用中的 Thread 数 */
  active: number;
  /** 复用命中率（0~1），无请求时为 0 */
  hitRate: number;
}

// ─── 复用计数器 ──────────────────────────────────────────────

let hitCount = 0;
let missCount = 0;

export function getThreadPoolHitMiss(): { hit: number; miss: number } {
  return { hit: hitCount, miss: missCount };
}

// ─── Thread 池实现 ───────────────────────────────────────────

class ThreadPool {
  private pool = new Map<string, ThreadPoolEntry[]>();
  private cleanupTimer: NodeJS.Timeout | null = null;

  private slotKey(accountId: string, model: string): string {
    return `${accountId}:${model}`;
  }

  /**
   * 获取一个可用的 Thread。优先从池中复用空闲 Thread，没有则新建。
   *
   * @param accountId  归属账号 ID
   * @param model      使用的模型
   * @param codex      Codex SDK 实例（用于新建 Thread）
   * @param opts       透传给 startThread 的额外选项
   */
  acquire(
    accountId: string,
    model: string,
    codex: Codex,
    opts?: { modelReasoningEffort?: ModelReasoningEffort },
  ): ThreadPoolEntry {
    if (!THREAD_POOL_ENABLED) {
      // 池化未启用，直接新建
      return this.createEntry(accountId, model, codex, opts);
    }

    const key = this.slotKey(accountId, model);
    const entries = this.pool.get(key);

    if (entries) {
      // 从末尾（最近使用）向前查找空闲 entry
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        if (entry.inUse) continue;

        // 检查超龄或超次
        const now = Date.now();
        if (now - entry.createdAt > MAX_THREAD_AGE_MS || entry.usageCount >= MAX_USAGE_COUNT) {
          // 销毁并从数组中移除
          entries.splice(i, 1);
          logger.debug('Thread evicted (aged/maxed)', {
            accountId, model, age: now - entry.createdAt, usageCount: entry.usageCount,
          });
          continue;
        }

        // 复用
        entry.inUse = true;
        entry.usageCount++;
        entry.lastUsedAt = Date.now();
        hitCount++;
        logger.debug('Thread reused', { accountId, model, usageCount: entry.usageCount });
        return entry;
      }
    }

    // 没有找到可复用的，新建
    missCount++;
    return this.createEntry(accountId, model, codex, opts);
  }

  /**
   * 归还 Thread 到池中。如果池化未启用或 Thread 已超龄/超次/slot 满了，则直接销毁。
   */
  release(entry: ThreadPoolEntry): void {
    entry.inUse = false;
    entry.lastUsedAt = Date.now();

    if (!THREAD_POOL_ENABLED) {
      // 池化未启用，不保留
      this.destroyEntry(entry);
      return;
    }

    const now = Date.now();

    // 超龄或超次，直接销毁
    if (now - entry.createdAt > MAX_THREAD_AGE_MS || entry.usageCount >= MAX_USAGE_COUNT) {
      this.destroyEntry(entry);
      logger.debug('Thread destroyed on release (aged/maxed)', {
        accountId: entry.accountId, model: entry.model,
        age: now - entry.createdAt, usageCount: entry.usageCount,
      });
      return;
    }

    const key = this.slotKey(entry.accountId, entry.model);
    const entries = this.pool.get(key);
    if (!entries) {
      // entry 已被 evict 过，直接销毁
      this.destroyEntry(entry);
      return;
    }

    // 统计当前 slot 的空闲数
    const idleCount = entries.filter((e) => !e.inUse).length;
    if (idleCount > MAX_IDLE_PER_SLOT) {
      // 超出上限，用 LRU 淘汰最旧的空闲 Thread
      const oldest = entries
        .filter((e) => !e.inUse)
        .sort((a, b) => a.lastUsedAt - b.lastUsedAt)[0];
      if (oldest) {
        const idx = entries.indexOf(oldest);
        if (idx !== -1) entries.splice(idx, 1);
        this.destroyEntry(oldest);
        logger.debug('Thread evicted (LRU)', {
          accountId: oldest.accountId, model: oldest.model,
        });
      }
      // 清理空 slot
      if (entries.length === 0) this.pool.delete(key);
    }
  }

  /**
   * 驱逐指定账号的所有 Thread（账号被 disabled / deleted 时调用）。
   * 如果不传 accountId 则驱逐全部。
   */
  evict(accountId?: string): void {
    if (!accountId) {
      this.evictAll();
      return;
    }

    let evicted = 0;
    for (const [key, entries] of this.pool) {
      if (!key.startsWith(`${accountId}:`)) continue;
      for (const entry of entries) {
        if (!entry.inUse) {
          this.destroyEntry(entry);
          evicted++;
        }
        // 正在使用中的 Thread 不能立即销毁，标记为超龄让它在 release 时被回收
        else {
          entry.createdAt = 0; // 强制超龄
        }
      }
      // 保留 inUse 的 entries，移除空闲的
      const remaining = entries.filter((e) => e.inUse);
      if (remaining.length > 0) {
        this.pool.set(key, remaining);
      } else {
        this.pool.delete(key);
      }
    }

    if (evicted > 0) {
      logger.debug('Threads evicted for account', { accountId, count: evicted });
    }
  }

  /**
   * 驱逐全部 Thread（优雅关闭时调用）。
   */
  evictAll(): void {
    let total = 0;
    for (const entries of this.pool.values()) {
      for (const entry of entries) {
        this.destroyEntry(entry);
        total++;
      }
    }
    this.pool.clear();
    if (total > 0) {
      logger.debug('All pooled threads evicted', { count: total });
    }
  }

  /**
   * 将一个特定 Thread 标记为脏并从池中移除（请求失败时调用）。
   * 通过 entry 引用精确定位。
   */
  evictEntry(entry: ThreadPoolEntry): void {
    const key = this.slotKey(entry.accountId, entry.model);
    const entries = this.pool.get(key);
    if (entries) {
      const idx = entries.indexOf(entry);
      if (idx !== -1) entries.splice(idx, 1);
      if (entries.length === 0) this.pool.delete(key);
    }
    this.destroyEntry(entry);
    logger.debug('Thread evicted (dirty)', {
      accountId: entry.accountId, model: entry.model,
    });
  }

  /**
   * 获取池状态快照。
   */
  getStats(): ThreadPoolStats {
    let size = 0;
    let idle = 0;
    for (const entries of this.pool.values()) {
      for (const entry of entries) {
        size++;
        if (!entry.inUse) idle++;
      }
    }
    const total = hitCount + missCount;
    return {
      size,
      idle,
      active: size - idle,
      hitRate: total > 0 ? Math.round((hitCount / total) * 10000) / 10000 : 0,
    };
  }

  /**
   * 启动定期清理定时器，扫描并销毁超龄空闲 Thread。
   */
  startCleanup(): NodeJS.Timeout {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      let cleaned = 0;

      for (const [key, entries] of this.pool) {
        for (let i = entries.length - 1; i >= 0; i--) {
          const entry = entries[i];
          if (entry.inUse) continue;
          if (now - entry.createdAt > MAX_THREAD_AGE_MS || entry.usageCount >= MAX_USAGE_COUNT) {
            entries.splice(i, 1);
            this.destroyEntry(entry);
            cleaned++;
          }
        }
        if (entries.length === 0) this.pool.delete(key);
      }

      if (cleaned > 0) {
        logger.debug('Thread pool cleanup', { cleaned, ...this.getStats() });
      }
    }, CLEANUP_INTERVAL_MS);

    return this.cleanupTimer;
  }

  /**
   * 停止清理定时器。
   */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  // ─── 内部方法 ──────────────────────────────────────────────

  private createEntry(
    accountId: string,
    model: string,
    codex: Codex,
    opts?: { modelReasoningEffort?: ModelReasoningEffort },
  ): ThreadPoolEntry {
    const thread = codex.startThread({
      skipGitRepoCheck: true,
      model,
      ...(opts?.modelReasoningEffort && { modelReasoningEffort: opts.modelReasoningEffort }),
    });

    const entry: ThreadPoolEntry = {
      thread,
      accountId,
      model,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      inUse: true,
      usageCount: 1,
    };

    // 加入池（即使池化未启用也加入，方便 evictEntry 查找）
    const key = this.slotKey(accountId, model);
    let entries = this.pool.get(key);
    if (!entries) {
      entries = [];
      this.pool.set(key, entries);
    }
    entries.push(entry);

    return entry;
  }

  /**
   * 销毁一个 Thread entry。
   * 目前 Codex SDK 的 Thread 没有显式的 destroy/close 方法，
   * 这里只做引用清理，让 GC 回收底层资源。
   */
  private destroyEntry(_entry: ThreadPoolEntry): void {
    // Thread 没有 close/destroy API，依赖 GC
    // 如果未来 SDK 增加了清理方法，在这里调用
  }
}

/** 全局单例 */
export const threadPool = new ThreadPool();
