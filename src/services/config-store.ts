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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CONFIG_PATH = join(__dirname, '..', '..', 'data', 'config.json');

// ─── Types ──────────────────────────────────────────────────

export interface ApiKeyEntry {
  /** API Key 值，如 sk-xxx */
  key: string;
  /** 显示名称 / 备注 */
  name: string;
  /** 该 Key 可用的模型列表，空数组表示继承 defaultModels */
  models: string[];
  /** 创建时间 */
  createdAt: string;
}

export interface AdminAuth {
  /** 管理面板登录用户名 */
  username: string;
  /** 管理面板登录密码 */
  password: string;
}

export interface AppConfig {
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
  username: 'admin',
  password: 'admin',
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
    return config;
  }
  const raw = await readFile(CONFIG_PATH, 'utf-8');
  const parsed = JSON.parse(raw) as Partial<AppConfig>;
  // 兼容旧配置：补齐 adminAuth 字段
  config = {
    adminAuth: parsed.adminAuth ?? { ...DEFAULT_ADMIN_AUTH },
    defaultModels: parsed.defaultModels ?? [...DEFAULT_MODELS],
    apiKeys: parsed.apiKeys ?? [],
  };
  return config;
}

export async function saveConfig(): Promise<void> {
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

// ─── Getters ────────────────────────────────────────────────

export function getConfig(): AppConfig {
  return config;
}

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

export function getAdminAuth(): AdminAuth {
  return { ...config.adminAuth };
}

export function verifyAdminAuth(username: string, password: string): boolean {
  return config.adminAuth.username === username && config.adminAuth.password === password;
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
  await saveConfig();
  return config.apiKeys[index];
}

export async function removeApiKey(key: string): Promise<boolean> {
  const index = config.apiKeys.findIndex((k) => k.key === key);
  if (index === -1) return false;
  config.apiKeys.splice(index, 1);
  await saveConfig();
  return true;
}

// ─── Default Models CRUD ────────────────────────────────────

export async function setDefaultModels(models: string[]): Promise<void> {
  config.defaultModels = models;
  await saveConfig();
}

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
