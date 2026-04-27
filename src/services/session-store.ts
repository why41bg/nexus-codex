import type { Codex, Thread, ModelReasoningEffort } from '@openai/codex-sdk';
import { randomUUID } from 'node:crypto';
import type { SessionInfo } from '../types.js';
import { pool } from './account-pool.js';

const sessions = new Map<string, SessionInfo>();

export interface CreateSessionOptions {
  model?: string;
  modelReasoningEffort?: ModelReasoningEffort;
}

/**
 * 创建新会话：启动一个 Thread 并绑定到指定账号。
 * 可选传入 model 和 modelReasoningEffort 透传给 SDK。
 */
export function createSession(
  accountId: string,
  codex: Codex,
  options?: CreateSessionOptions,
): SessionInfo {
  const thread: Thread = codex.startThread({
    skipGitRepoCheck: true,
    ...(options?.model && { model: options.model }),
    ...(options?.modelReasoningEffort && { modelReasoningEffort: options.modelReasoningEffort }),
  });
  const conversationId = `conv-${randomUUID()}`;
  const session: SessionInfo = {
    conversationId,
    accountId,
    thread,
    lastActiveAt: Date.now(),
  };
  sessions.set(conversationId, session);
  return session;
}

/**
 * 根据 conversationId 获取已有会话。
 */
export function getSession(conversationId: string): SessionInfo | undefined {
  return sessions.get(conversationId);
}

/**
 * 删除会话，同时释放关联的账号池占用。
 */
export function deleteSession(conversationId: string): boolean {
  const session = sessions.get(conversationId);
  if (!session) return false;
  sessions.delete(conversationId);
  pool.release(session.accountId);
  return true;
}

/**
 * 更新会话的最后活跃时间。
 */
export function touchSession(conversationId: string): void {
  const session = sessions.get(conversationId);
  if (session) session.lastActiveAt = Date.now();
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
    for (const [id, session] of sessions) {
      if (now - session.lastActiveAt > maxIdleMs) {
        sessions.delete(id);
        pool.release(session.accountId);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      console.log(`🧹 Cleaned ${cleaned} idle session(s)`);
    }
  }, intervalMs);
  return timer;
}

/**
 * 清理所有会话（优雅关闭时使用）。
 */
export function clearAllSessions(): void {
  for (const [id, session] of sessions) {
    pool.release(session.accountId);
    sessions.delete(id);
  }
}
