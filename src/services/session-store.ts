import type { Codex, ModelReasoningEffort } from '@openai/codex-sdk';
import { randomUUID } from 'node:crypto';
import type { SessionInfo } from '../types.js';
import { pool } from './account-pool.js';
import { threadPool, type ThreadPoolEntry } from './thread-pool.js';
import { logger } from '../utils/logger.js';

/** 会话记录，额外持有 ThreadPoolEntry 引用以便归还 */
interface SessionRecord {
  info: SessionInfo;
  poolEntry: ThreadPoolEntry;
}

const sessions = new Map<string, SessionRecord>();

export interface CreateSessionOptions {
  model?: string;
  modelReasoningEffort?: ModelReasoningEffort;
}

/**
 * 创建新会话：从 Thread 池获取（或新建）一个 Thread 并绑定到指定账号。
 * 可选传入 model 和 modelReasoningEffort 透传给 SDK。
 */
export function createSession(
  accountId: string,
  codex: Codex,
  options?: CreateSessionOptions,
): SessionInfo {
  const model = options?.model ?? 'codex-mini-latest';

  const tpEntry = threadPool.acquire(accountId, model, codex, {
    modelReasoningEffort: options?.modelReasoningEffort,
  });

  const conversationId = `conv-${randomUUID()}`;
  const info: SessionInfo = {
    conversationId,
    accountId,
    thread: tpEntry.thread,
    lastActiveAt: Date.now(),
  };

  sessions.set(conversationId, { info, poolEntry: tpEntry });
  return info;
}

/**
 * 删除会话：归还 Thread 到池中，并释放关联的账号池占用。
 */
export function deleteSession(conversationId: string): boolean {
  const record = sessions.get(conversationId);
  if (!record) return false;

  sessions.delete(conversationId);

  // 归还 Thread 到池（池内部决定是否保留复用）
  threadPool.release(record.poolEntry);

  // 释放账号并发槽位
  pool.release(record.info.accountId);
  return true;
}

/**
 * 获取指定会话的 ThreadPoolEntry（供错误处理时驱逐脏 Thread）。
 */
export function getSessionPoolEntry(conversationId: string): ThreadPoolEntry | null {
  const record = sessions.get(conversationId);
  return record?.poolEntry ?? null;
}

/**
 * 获取当前所有会话数量。
 */
export function sessionCount(): number {
  return sessions.size;
}

/**
 * 启动超时清理定时器。
 * 每 10 分钟扫描，清理超过 maxIdleMs 未活跃的会话。
 */
export function startSessionCleanup(
  intervalMs: number = 10 * 60 * 1000,
  maxIdleMs: number = 60 * 60 * 1000,
): NodeJS.Timeout {
  const timer = setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [id, record] of sessions) {
      if (now - record.info.lastActiveAt > maxIdleMs) {
        sessions.delete(id);
        threadPool.release(record.poolEntry);
        pool.release(record.info.accountId);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      logger.debug('Cleaned idle sessions', { count: cleaned });
    }
  }, intervalMs);
  return timer;
}

/**
 * 清理所有会话（优雅关闭时使用）。
 */
export function clearAllSessions(): void {
  for (const [id, record] of sessions) {
    threadPool.release(record.poolEntry);
    pool.release(record.info.accountId);
    sessions.delete(id);
  }
}
