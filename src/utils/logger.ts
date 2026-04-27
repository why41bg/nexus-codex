import { pool } from '../services/account-pool.js';

// ─── ANSI color helpers ─────────────────────────────────────
const c = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  bold: '\x1b[1m',
};

function timestamp(): string {
  return `${c.dim}${new Date().toISOString()}${c.reset}`;
}

function statusColor(status: number): string {
  if (status >= 500) return c.red;
  if (status >= 400) return c.yellow;
  return c.green;
}

/**
 * 打印 HTTP 请求日志，包含方法、路径、状态码、耗时。
 */
export function logRequest(method: string, path: string, status: number, durationMs: number): void {
  const sc = statusColor(status);
  console.log(
    `${timestamp()} ${c.bold}${method}${c.reset} ${path} ${sc}${status}${c.reset} ${c.dim}${durationMs}ms${c.reset}`,
  );
}

/**
 * 打印账号池状态快照。
 */
function poolSnapshot(): string {
  const entries = pool.getStatus();
  const total = entries.length;
  const busy = entries.filter((e) => e.busy).length;
  const unhealthy = entries.filter((e) => !e.healthy && !e.busy).length;
  const available = entries.filter((e) => !e.busy && e.healthy).length;
  return (
    `${c.cyan}pool${c.reset} ` +
    `total=${c.bold}${total}${c.reset} ` +
    `available=${c.green}${available}${c.reset} ` +
    `busy=${busy > 0 ? c.yellow : c.dim}${busy}${c.reset} ` +
    `unhealthy=${unhealthy > 0 ? c.red : c.dim}${unhealthy}${c.reset}`
  );
}

/**
 * 请求开始时：打印分配到的账号 + 池快照。
 */
export function logAcquire(accountId: string): void {
  console.log(
    `${timestamp()} ${c.magenta}acquire${c.reset} account=${c.bold}${accountId}${c.reset}  ${poolSnapshot()}`,
  );
}

/**
 * 请求结束时：打印释放的账号 + 池快照 + 耗时。
 */
export function logRelease(accountId: string, durationMs: number, error?: string): void {
  const suffix = error
    ? ` ${c.red}error=${error}${c.reset}`
    : ` ${c.green}ok${c.reset}`;
  console.log(
    `${timestamp()} ${c.blue}release${c.reset} account=${c.bold}${accountId}${c.reset} ${c.dim}${durationMs}ms${c.reset}${suffix}  ${poolSnapshot()}`,
  );
}

/**
 * 排队超时后仍无可用账号（返回 429）时打印。
 */
export function logPoolExhausted(): void {
  console.log(
    `${timestamp()} ${c.red}${c.bold}pool exhausted${c.reset} (queue timed out)  ${poolSnapshot()}`,
  );
}
