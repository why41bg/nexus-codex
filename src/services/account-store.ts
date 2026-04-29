import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { Account } from '../types.js';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_PATH = join(__dirname, '..', '..', 'data', 'accounts.json');

// ─── 内存缓存，避免每次请求都读磁盘 ──────────────────────
let accountsCache: Account[] | null = null;

// ─── 写入互斥锁，防止并发写入导致数据丢失 ─────────────────
let writeLock = Promise.resolve();

export async function loadAccounts(): Promise<Account[]> {
  if (accountsCache) {
    return accountsCache.map((a) => ({ ...a }));
  }
  try {
    if (!existsSync(DATA_PATH)) {
      return [];
    }
    const raw = await readFile(DATA_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      logger.warn('accounts.json contains non-array data, resetting to empty');
      return [];
    }
    accountsCache = parsed as Account[];
    return accountsCache.map((a) => ({ ...a }));
  } catch (err) {
    logger.error('Failed to load accounts.json, falling back to empty array', { error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

async function saveAccounts(accounts: Account[]): Promise<void> {
  // 使用互斥锁串行化写入操作
  const prevLock = writeLock;
  let releaseLock: () => void;
  writeLock = new Promise<void>((resolve) => { releaseLock = resolve; });

  await prevLock;
  try {
    // 确保 data/ 目录存在（全新机器首次启动时目录可能不存在）
    await mkdir(dirname(DATA_PATH), { recursive: true });
    // 先写临时文件再 rename，保证原子写入
    const tmpPath = DATA_PATH + '.tmp';
    await writeFile(tmpPath, JSON.stringify(accounts, null, 2) + '\n', 'utf-8');
    await rename(tmpPath, DATA_PATH);
    accountsCache = accounts.map((a) => ({ ...a }));
  } finally {
    releaseLock!();
  }
}

export async function addAccount(codexHome: string, remark: string, maxConcurrency?: number): Promise<Account> {
  const accounts = await loadAccounts();
  const newAccount: Account = {
    id: `acc-${randomUUID().slice(0, 12)}`,
    codexHome,
    enabled: true,
    healthy: true,
    remark,
    usageCount: 0,
    lastUsedAt: null,
    ...(maxConcurrency !== undefined && { maxConcurrency }),
  };
  accounts.push(newAccount);
  await saveAccounts(accounts);
  return newAccount;
}

export async function updateAccount(
  id: string,
  partial: Partial<Omit<Account, 'id'>>,
): Promise<Account | null> {
  const accounts = await loadAccounts();
  const index = accounts.findIndex((a) => a.id === id);
  if (index === -1) return null;
  accounts[index] = { ...accounts[index], ...partial };
  await saveAccounts(accounts);
  return accounts[index];
}

/**
 * 原子递增 usageCount 并更新 lastUsedAt。
 * 内部加锁保证读-改-写的原子性，避免并发丢失写入。
 */
export async function incrementUsageCount(id: string): Promise<void> {
  const accounts = await loadAccounts();
  const acc = accounts.find((a) => a.id === id);
  if (acc) {
    acc.usageCount += 1;
    acc.lastUsedAt = new Date().toISOString();
    await saveAccounts(accounts);
  }
}

export async function removeAccount(id: string): Promise<boolean> {
  const accounts = await loadAccounts();
  const index = accounts.findIndex((a) => a.id === id);
  if (index === -1) return false;
  accounts.splice(index, 1);
  await saveAccounts(accounts);
  return true;
}
