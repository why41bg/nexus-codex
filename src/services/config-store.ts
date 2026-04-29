/**
 * 配置持久化存储：管理 data/config.json。
 *
 * 存储内容包括：
 * - apiKeys：API Key 列表，每个 Key 可独立配置可用模型
 * - defaultModels：全局默认模型列表（Key 未单独配置模型时使用）
 */

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual, createHmac } from 'node:crypto';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CONFIG_PATH = join(__dirname, '..', '..', 'data', 'config.json');

// ─── Types ──────────────────────────────────────────────────

interface ApiKeyEntry {
  /** API Key 值，如 sk-xxx */
  key: string;
  /** 显示名称 / 备注 */
  name: string;
  /** 该 Key 可用的模型列表，空数组表示继承 defaultModels */
  models: string[];
  /** 创建时间 */
  createdAt: string;

  // ——— 权限粒度扩展字段 ———
  /** ISO 8601 过期时间，null 表示永不过期 */
  expiresAt?: string | null;
  /** 独立速率限制（req/window），null 继承全局 */
  rateLimitMax?: number | null;
  /** 独立限流窗口（ms），null 继承全局 */
  rateLimitWindowMs?: number | null;
  /** 月调用次数上限，null 不限制 */
  monthlyQuota?: number | null;
  /** 当月已用次数 */
  monthlyUsage?: number;
  /** 月配额重置时间（每月 1 日 00:00 UTC） */
  monthlyResetAt?: string;
  /** IP 白名单，空数组表示不限制 */
  ipWhitelist?: string[];
}

interface AdminAuth {
  /** 管理面板登录用户名 */
  username: string;
  /** 管理面板登录密码 */
  password: string;
}

interface AppConfig {
  /** 管理面板账号密码 */
  adminAuth: AdminAuth;
  /** 全局默认模型列表 */
  defaultModels: string[];
  /** API Key 列表 */
  apiKeys: ApiKeyEntry[];
}

// ─── Default config ─────────────────────────────────────────

const DEFAULT_MODELS = [
  'gpt-5.4',
  'gpt-5.5',
  'gpt-5.4-mini',
  'gpt-5.3-codex',
  'gpt-5.2',
];

const DEFAULT_ADMIN_AUTH: AdminAuth = {
  username: process.env.ADMIN_USERNAME || 'admin',
  password: process.env.ADMIN_PASSWORD || 'admin',
};

function createDefaultConfig(): AppConfig {
  return {
    adminAuth: { ...DEFAULT_ADMIN_AUTH },
    defaultModels: [...DEFAULT_MODELS],
    apiKeys: [],
  };
}

// ─── In-memory state ────────────────────────────────────────

let config: AppConfig = createDefaultConfig();

// ─── 写入互斥锁，防止并发写入导致配置丢失 ─────────────────
let writeLock = Promise.resolve();

// ─── File I/O ───────────────────────────────────────────────

export async function loadConfig(): Promise<AppConfig> {
  if (!existsSync(CONFIG_PATH)) {
    config = createDefaultConfig();
    await saveConfig();
  } else {
    const raw = await readFile(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    // 兼容旧配置：补齐 adminAuth 字段
    config = {
      adminAuth: parsed.adminAuth ?? { ...DEFAULT_ADMIN_AUTH },
      defaultModels: parsed.defaultModels ?? [...DEFAULT_MODELS],
      apiKeys: parsed.apiKeys ?? [],
    };

    // 向后兼容：为已有 apiKey 条目补齐新增权限字段
    for (const k of config.apiKeys) {
      k.expiresAt ??= null;
      k.rateLimitMax ??= null;
      k.rateLimitWindowMs ??= null;
      k.monthlyQuota ??= null;
      k.monthlyUsage ??= 0;
      k.monthlyResetAt ??= getNextMonthReset();
      k.ipWhitelist ??= [];
    }
  }

  // 检测默认密码并发出安全警告
  if (config.adminAuth.username === 'admin' && config.adminAuth.password === 'admin') {
    logger.warn(
      'Admin credentials are set to default (admin/admin). Please change them via environment variables ADMIN_USERNAME/ADMIN_PASSWORD or update data/config.json before deploying to production.',
    );
  }

  return config;
}

async function saveConfig(): Promise<void> {
  const prevLock = writeLock;
  let releaseLock: () => void;
  writeLock = new Promise<void>((resolve) => { releaseLock = resolve; });

  await prevLock;
  try {
    // 确保 data/ 目录存在（全新机器首次启动时目录可能不存在）
    await mkdir(dirname(CONFIG_PATH), { recursive: true });
    // 先写临时文件再 rename，保证原子写入
    const tmpPath = CONFIG_PATH + '.tmp';
    await writeFile(tmpPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    await rename(tmpPath, CONFIG_PATH);
  } finally {
    releaseLock!();
  }
}

// ─── API Key Set 缓存（避免每次请求重建） ──────────────────
let apiKeySetCache: Set<string> | null = null;

function invalidateApiKeyCache(): void {
  apiKeySetCache = null;
}

export function getApiKeySet(): Set<string> {
  if (!apiKeySetCache) {
    apiKeySetCache = new Set(config.apiKeys.map((k) => k.key));
  }
  return apiKeySetCache;
}

// ─── Getters ────────────────────────────────────────────────

export function getDefaultModels(): string[] {
  return [...config.defaultModels];
}

export function getApiKeys(): ApiKeyEntry[] {
  return config.apiKeys;
}

export function findApiKey(key: string): ApiKeyEntry | undefined {
  return config.apiKeys.find((k) => k.key === key);
}

/**
 * 获取某个 API Key 的可用模型列表。
 * 如果该 Key 配置了独立模型列表则返回它，否则返回全局默认列表。
 */
export function getModelsForKey(key: string): string[] {
  const entry = findApiKey(key);
  if (!entry) return [];
  return entry.models.length > 0 ? [...entry.models] : [...config.defaultModels];
}

/**
 * 检查某个模型对于指定 API Key 是否可用。
 */
export function isModelAllowedForKey(key: string, modelId: string): boolean {
  const models = getModelsForKey(key);
  return models.includes(modelId);
}

/**
 * 常量时间比较两个字符串。
 * 先对双方做 HMAC-SHA256 归一化到固定 32 字节，再用 timingSafeEqual 比较，
 * 从而避免泄露原始值的长度信息。
 */
const HMAC_KEY = 'nexus-codex-constant-time-cmp';

function constantTimeEqual(a: string, b: string): boolean {
  const ha = createHmac('sha256', HMAC_KEY).update(a).digest();
  const hb = createHmac('sha256', HMAC_KEY).update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function verifyAdminAuth(username: string, password: string): boolean {
  const userMatch = constantTimeEqual(username, config.adminAuth.username);
  const passMatch = constantTimeEqual(password, config.adminAuth.password);
  return userMatch && passMatch;
}

// ─── API Key CRUD ───────────────────────────────────────────

export async function addApiKey(
  key: string,
  name: string,
  models: string[] = [],
  extra: Partial<Pick<ApiKeyEntry, 'expiresAt' | 'rateLimitMax' | 'rateLimitWindowMs' | 'monthlyQuota' | 'ipWhitelist'>> = {},
): Promise<ApiKeyEntry> {
  const entry: ApiKeyEntry = {
    key,
    name,
    models,
    createdAt: new Date().toISOString(),
    expiresAt: extra.expiresAt ?? null,
    rateLimitMax: extra.rateLimitMax ?? null,
    rateLimitWindowMs: extra.rateLimitWindowMs ?? null,
    monthlyQuota: extra.monthlyQuota ?? null,
    monthlyUsage: 0,
    monthlyResetAt: getNextMonthReset(),
    ipWhitelist: extra.ipWhitelist ?? [],
  };
  config.apiKeys.push(entry);
  invalidateApiKeyCache();
  await saveConfig();
  return entry;
}

export async function updateApiKey(
  key: string,
  partial: Partial<Pick<ApiKeyEntry, 'name' | 'models' | 'expiresAt' | 'rateLimitMax' | 'rateLimitWindowMs' | 'monthlyQuota' | 'ipWhitelist'>>,
): Promise<ApiKeyEntry | null> {
  const index = config.apiKeys.findIndex((k) => k.key === key);
  if (index === -1) return null;
  if (partial.name !== undefined) config.apiKeys[index].name = partial.name;
  if (partial.models !== undefined) config.apiKeys[index].models = partial.models;
  if (partial.expiresAt !== undefined) config.apiKeys[index].expiresAt = partial.expiresAt;
  if (partial.rateLimitMax !== undefined) config.apiKeys[index].rateLimitMax = partial.rateLimitMax;
  if (partial.rateLimitWindowMs !== undefined) config.apiKeys[index].rateLimitWindowMs = partial.rateLimitWindowMs;
  if (partial.monthlyQuota !== undefined) config.apiKeys[index].monthlyQuota = partial.monthlyQuota;
  if (partial.ipWhitelist !== undefined) config.apiKeys[index].ipWhitelist = partial.ipWhitelist;
  invalidateApiKeyCache();
  await saveConfig();
  return config.apiKeys[index];
}

export async function removeApiKey(key: string): Promise<boolean> {
  const index = config.apiKeys.findIndex((k) => k.key === key);
  if (index === -1) return false;
  config.apiKeys.splice(index, 1);
  invalidateApiKeyCache();
  await saveConfig();
  return true;
}

// ─── Default Models CRUD ────────────────────────────────────

export async function addDefaultModel(modelId: string): Promise<boolean> {
  if (config.defaultModels.includes(modelId)) return false;
  config.defaultModels.push(modelId);
  await saveConfig();
  return true;
}

export async function removeDefaultModel(modelId: string): Promise<boolean> {
  const index = config.defaultModels.indexOf(modelId);
  if (index === -1) return false;
  config.defaultModels.splice(index, 1);
  await saveConfig();
  return true;
}

// ─── 月配额辅助方法 ─────────────────────────────────────────

/** 计算下个月 1 日 00:00 UTC 的 ISO 字符串 */
function getNextMonthReset(): string {
  const now = new Date();
  const year = now.getUTCMonth() === 11 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
  const month = now.getUTCMonth() === 11 ? 0 : now.getUTCMonth() + 1;
  return new Date(Date.UTC(year, month, 1)).toISOString();
}

/**
 * 递增指定 API Key 的月使用计数。
 * 如果当前时间已过重置时间，先重置计数。
 */
export async function incrementKeyMonthlyUsage(key: string): Promise<void> {
  const entry = config.apiKeys.find((k) => k.key === key);
  if (!entry) return;

  // 检查是否需要重置月计数
  if (entry.monthlyResetAt && new Date() >= new Date(entry.monthlyResetAt)) {
    entry.monthlyUsage = 0;
    entry.monthlyResetAt = getNextMonthReset();
  }

  entry.monthlyUsage = (entry.monthlyUsage ?? 0) + 1;
  await saveConfig();
}
