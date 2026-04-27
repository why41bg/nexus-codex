import { pool } from '../services/account-pool.js';

// ─── Log levels ─────────────────────────────────────────────
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

// ─── Structured log output ──────────────────────────────────

interface LogEntry {
  level: LogLevel;
  time: string;
  msg: string;
  [key: string]: unknown;
}

function emit(entry: LogEntry): void {
  const output = JSON.stringify(entry);
  if (entry.level === 'error') {
    console.error(output);
  } else if (entry.level === 'warn') {
    console.warn(output);
  } else {
    console.log(output);
  }
}

function log(level: LogLevel, msg: string, extra?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;
  emit({ level, time: new Date().toISOString(), msg, ...extra });
}

// ─── Public API ─────────────────────────────────────────────

export const logger = {
  debug: (msg: string, extra?: Record<string, unknown>) => log('debug', msg, extra),
  info: (msg: string, extra?: Record<string, unknown>) => log('info', msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) => log('warn', msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) => log('error', msg, extra),
};

// ─── Pool snapshot helper ───────────────────────────────────

function poolSnapshot(): Record<string, number> {
  const entries = pool.getStatus();
  return {
    total: entries.length,
    available: entries.filter((e) => !e.busy && e.healthy).length,
    busy: entries.filter((e) => e.busy).length,
    unhealthy: entries.filter((e) => !e.healthy && !e.busy).length,
  };
}

// ─── Domain-specific log helpers ────────────────────────────

/**
 * 打印 HTTP 请求日志，包含方法、路径、状态码、耗时。
 */
export function logRequest(method: string, path: string, status: number, durationMs: number): void {
  logger.info('http request', { method, path, status, durationMs });
}

/**
 * 请求开始时：打印分配到的账号 + 池快照。
 */
export function logAcquire(accountId: string): void {
  logger.info('acquire account', { accountId, pool: poolSnapshot() });
}

/**
 * 请求结束时：打印释放的账号 + 池快照 + 耗时。
 */
export function logRelease(accountId: string, durationMs: number, error?: string): void {
  logger.info('release account', {
    accountId,
    durationMs,
    ...(error ? { error } : {}),
    pool: poolSnapshot(),
  });
}

/**
 * 排队超时后仍无可用账号（返回 429）时打印。
 */
export function logPoolExhausted(): void {
  logger.warn('pool exhausted (queue timed out)', { pool: poolSnapshot() });
}
