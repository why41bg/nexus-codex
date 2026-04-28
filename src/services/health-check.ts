import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { pool } from './account-pool.js';
import { updateAccount } from './account-store.js';
import { logger } from '../utils/logger.js';
import { emitAdminEvent } from './admin-emitter.js';

interface HealthCheckOptions {
  /** 高频本地 JWT 检查间隔（毫秒），默认 1 分钟 */
  localIntervalMs?: number;
  /** 低频 login status 检查间隔（毫秒），默认 15 分钟 */
  remoteIntervalMs?: number;
  /** login status 命令超时（毫秒），默认 15 秒 */
  remoteTimeoutMs?: number;
  /** JWT 过期预警缓冲（秒），默认 5 分钟 */
  tokenExpiryBufferSec?: number;
  /** 连续失败多少次才标记为 unhealthy，默认 2 */
  failThreshold?: number;
}

const DEFAULT_LOCAL_INTERVAL  = 1  * 60 * 1000;
const DEFAULT_REMOTE_INTERVAL = 15 * 60 * 1000;
const DEFAULT_REMOTE_TIMEOUT  = 15 * 1000;
const DEFAULT_EXPIRY_BUFFER   = 5  * 60;        // 秒
const DEFAULT_FAIL_THRESHOLD  = 2;

// 记录每个账号的连续失败次数（本地 + 远程共用同一计数器）
const failCounts = new Map<string, number>();

// ─── 公共状态更新逻辑 ───────────────────────────────────────

async function handleProbeResult(
  accountId: string,
  healthy: boolean,
  failThreshold: number,
  source: 'local' | 'remote',
): Promise<void> {
  const wasHealthy = pool.entries().find((e) => e.accountId === accountId)?.healthy ?? true;

  if (healthy) {
    failCounts.set(accountId, 0);
    if (!wasHealthy) {
      pool.updateEntry(accountId, { healthy: true });
      await updateAccount(accountId, { healthy: true });
      emitAdminEvent({ type: 'health_changed', accountId, healthy: true });
      logger.info('Account recovered to healthy', { accountId, source });
    }
  } else {
    const count = (failCounts.get(accountId) ?? 0) + 1;
    failCounts.set(accountId, count);
    if (count >= failThreshold && wasHealthy) {
      pool.updateEntry(accountId, { healthy: false });
      await updateAccount(accountId, { healthy: false });
      emitAdminEvent({ type: 'health_changed', accountId, healthy: false });
      logger.warn('Account marked unhealthy', { accountId, source, failCount: count });
    }
  }
}

// ─── 高频：本地 JWT 检查 ────────────────────────────────────

/**
 * 读取 CODEX_HOME/auth.json，解析 access_token 的 JWT exp 字段。
 * 纯本地 I/O，耗时 < 1ms，零网络请求。
 */
export async function probeLocal(codexHome: string, expiryBufferSec: number): Promise<boolean> {
  try {
    const authPath = join(codexHome, 'auth.json');
    const raw = await readFile(authPath, 'utf-8');
    const auth = JSON.parse(raw) as {
      tokens?: { access_token?: string };
    };

    const accessToken = auth?.tokens?.access_token;
    if (!accessToken) return false;

    // 解析 JWT payload（Base64URL 解码，不验签——仅用于过期时间判断）
    const parts = accessToken.split('.');
    if (parts.length !== 3) return false;

    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf-8'),
    ) as { exp?: number };

    const exp = payload.exp ?? 0;
    const expiresIn = exp - Date.now() / 1000;
    return expiresIn > expiryBufferSec;
  } catch {
    return false;
  }
}

// ─── 低频：codex login status 检查 ─────────────────────────

/**
 * 执行 `codex login status`，验证凭证在服务端是否仍然有效。
 * 能捕获封号、配额耗尽等服务端异常，但需要启动子进程（约 5 秒）。
 *
 * @param spawnFn 可注入的 spawn 实现，默认使用 node:child_process.spawn，测试时可传入 mock
 */
export async function probeRemote(
  codexHome: string,
  timeoutMs: number,
  spawnFn: typeof spawn = spawn,
): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawnFn('codex', ['login', 'status'], {
      env: { ...process.env, CODEX_HOME: codexHome },
    });

    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });

    const timer = setTimeout(() => {
      child.kill();
      logger.warn('Remote probe timed out', { codexHome, timeoutMs });
      resolve(false);
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0 && stdout.toLowerCase().includes('logged in'));
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      logger.warn('Remote probe spawn error', { codexHome, error: err.message });
      resolve(false);
    });
  });
}

// ─── 对外触发接口（被动感知） ───────────────────────────────

/**
 * 在请求失败后立即对指定账号执行一次本地探测。
 * 供 request-lifecycle 在捕获到错误时调用，无需等待定时器。
 */
export async function triggerProbe(accountId: string, expiryBufferSec = DEFAULT_EXPIRY_BUFFER): Promise<void> {
  const entry = pool.entries().find((e) => e.accountId === accountId);
  if (!entry) return;

  const healthy = await probeLocal(entry.codexHome, expiryBufferSec);
  await handleProbeResult(accountId, healthy, DEFAULT_FAIL_THRESHOLD, 'local');
}

// ─── 定时器启动 ─────────────────────────────────────────────

/**
 * 启动分层定时健康检查：
 * - 高频（默认 1 分钟）：本地 JWT 过期检查，零开销
 * - 低频（默认 15 分钟）：codex login status，验证服务端凭证有效性
 */
export function startHealthCheck(options?: HealthCheckOptions): { stop: () => void } {
  const localIntervalMs   = options?.localIntervalMs   ?? DEFAULT_LOCAL_INTERVAL;
  const remoteIntervalMs  = options?.remoteIntervalMs  ?? DEFAULT_REMOTE_INTERVAL;
  const remoteTimeoutMs   = options?.remoteTimeoutMs   ?? DEFAULT_REMOTE_TIMEOUT;
  const expiryBufferSec   = options?.tokenExpiryBufferSec ?? DEFAULT_EXPIRY_BUFFER;
  const failThreshold     = options?.failThreshold     ?? DEFAULT_FAIL_THRESHOLD;

  logger.debug('Health check started', {
    localIntervalSec:  localIntervalMs  / 1000,
    remoteIntervalSec: remoteIntervalMs / 1000,
    remoteTimeoutSec:  remoteTimeoutMs  / 1000,
    expiryBufferSec,
    failThreshold,
  });

  // 高频：本地 JWT 检查
  const localTimer = setInterval(async () => {
    for (const entry of pool.entries()) {
      try {
        const healthy = await probeLocal(entry.codexHome, expiryBufferSec);
        await handleProbeResult(entry.accountId, healthy, failThreshold, 'local');
      } catch (err) {
        const count = (failCounts.get(entry.accountId) ?? 0) + 1;
        failCounts.set(entry.accountId, count);
        logger.warn('Local probe error', {
          accountId: entry.accountId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }, localIntervalMs);

  // 低频：login status 检查（跳过满载账号，避免干扰正在处理的请求）
  const remoteTimer = setInterval(async () => {
    for (const entry of pool.entries()) {
      if (entry.activeCount >= entry.maxConcurrency) continue;
      try {
        const healthy = await probeRemote(entry.codexHome, remoteTimeoutMs);
        await handleProbeResult(entry.accountId, healthy, failThreshold, 'remote');
      } catch (err) {
        const count = (failCounts.get(entry.accountId) ?? 0) + 1;
        failCounts.set(entry.accountId, count);
        logger.warn('Remote probe error', {
          accountId: entry.accountId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }, remoteIntervalMs);

  return {
    stop: () => {
      clearInterval(localTimer);
      clearInterval(remoteTimer);
    },
  };
}
