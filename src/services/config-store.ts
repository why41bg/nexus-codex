/**
 * 配置持久化存储：管理 data/config.json。
 *
 * 存储内容包括：
 * - apiKeys：API Key 列表，每个 Key 可独立配置可用模型
 * - defaultModels：全局默认模型列表（Key 未单独配置模型时使用）
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
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
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf-8');
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

export function verifyAdminAuth(username: string, password: string): boolean {
  const expectedUser = Buffer.from(config.adminAuth.username);
  const expectedPass = Buffer.from(config.adminAuth.password);
  const inputUser = Buffer.from(username);
  const inputPass = Buffer.from(password);

  // 长度不同时仍需执行 timingSafeEqual 以避免泄露长度信息
  const userMatch =
    expectedUser.length === inputUser.length &&
    timingSafeEqual(expectedUser, inputUser);
  const passMatch =
    expectedPass.length === inputPass.length &&
    timingSafeEqual(expectedPass, inputPass);
  return userMatch && passMatch;
}

// ─── API Key CRUD ───────────────────────────────────────────

export async function addApiKey(key: string, name: string, models: string[] = []): Promise<ApiKeyEntry> {
  const entry: ApiKeyEntry = {
    key,
    name,
    models,
    createdAt: new Date().toISOString(),
  };
  config.apiKeys.push(entry);
  invalidateApiKeyCache();
  await saveConfig();
  return entry;
}

export async function updateApiKey(
  key: string,
  partial: Partial<Pick<ApiKeyEntry, 'name' | 'models'>>,
): Promise<ApiKeyEntry | null> {
  const index = config.apiKeys.findIndex((k) => k.key === key);
  if (index === -1) return null;
  if (partial.name !== undefined) config.apiKeys[index].name = partial.name;
  if (partial.models !== undefined) config.apiKeys[index].models = partial.models;
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
