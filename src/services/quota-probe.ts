/**
 * 通过 HTTP 直接查询 ChatGPT Plus 账号的配额/使用量信息。
 *
 * 读取 CODEX_HOME/auth.json 中的 access_token，请求
 * chatgpt.com/backend-api/codex/usage 端点获取额度数据。
 * 只需 Authorization + 显式 User-Agent 即可通过 Cloudflare，
 * 无需子进程、TLS 伪装或浏览器解题，单次延迟 < 1s。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../utils/logger.js';

// ─── Types ──────────────────────────────────────────────────

export interface QuotaWindow {
  /** 已使用百分比（0-100） */
  usedPercent: number;
  /** 窗口时长（分钟） */
  windowDurationMins: number;
  /** 重置时间（Unix 时间戳，秒） */
  resetsAt: number;
}

export interface QuotaCredits {
  hasCredits: boolean;
  unlimited: boolean;
  balance: string;
}

export interface QuotaInfo {
  /** 5小时滚动窗口 */
  primary: QuotaWindow;
  /** 1周滚动窗口 */
  secondary: QuotaWindow;
  credits: QuotaCredits;
  planType: string;
  /** null 表示未触达限制 */
  rateLimitReachedType: string | null;
}

// ─── Constants ──────────────────────────────────────────────

const USAGE_URL = 'https://chatgpt.com/backend-api/codex/usage';
const USER_AGENT = 'nexus-codex/1.0';

// ─── Cache ──────────────────────────────────────────────────

/** 缓存有效期（毫秒），默认 10 分钟 */
const CACHE_TTL_MS = Number(process.env.QUOTA_CACHE_TTL_MS) || 10 * 60 * 1000;

interface CacheEntry {
  data: QuotaInfo;
  expiresAt: number;
}

/** key = codexHome */
const cache = new Map<string, CacheEntry>();

/** 正在进行中的查询 Promise，防止同一账号并发重复请求 */
const inflight = new Map<string, Promise<QuotaInfo | null>>();

// ─── Helpers ────────────────────────────────────────────────

/** 从 auth.json 读取 access_token */
function readAccessToken(codexHome: string): string | null {
  try {
    const raw = readFileSync(join(codexHome, 'auth.json'), 'utf-8');
    const auth = JSON.parse(raw) as {
      tokens?: { access_token?: string };
    };
    return auth?.tokens?.access_token ?? null;
  } catch {
    return null;
  }
}

// ─── Raw API response shape ─────────────────────────────────

interface UsageApiWindow {
  used_percent: number;
  limit_window_seconds: number;
  reset_after_seconds: number;
  /** Unix 时间戳（秒） */
  reset_at: number;
}

interface UsageApiResponse {
  plan_type?: string;
  rate_limit_reached_type?: string | null;
  rate_limit?: {
    allowed?: boolean;
    limit_reached?: boolean;
    primary_window?: UsageApiWindow;
    secondary_window?: UsageApiWindow;
  };
  credits?: {
    has_credits?: boolean;
    unlimited?: boolean;
    balance?: string;
  };
  [key: string]: unknown;
}

// ─── Transform ──────────────────────────────────────────────

function toWindow(w: UsageApiWindow): QuotaWindow {
  return {
    usedPercent: w.used_percent,
    windowDurationMins: Math.round(w.limit_window_seconds / 60),
    resetsAt: w.reset_at,
  };
}

function transformResponse(data: UsageApiResponse): QuotaInfo | null {
  const rl = data.rate_limit;
  if (!rl?.primary_window || !rl?.secondary_window) return null;

  return {
    primary: toWindow(rl.primary_window),
    secondary: toWindow(rl.secondary_window),
    credits: {
      hasCredits: data.credits?.has_credits ?? false,
      unlimited: data.credits?.unlimited ?? false,
      balance: data.credits?.balance ?? '0',
    },
    planType: data.plan_type ?? 'unknown',
    rateLimitReachedType: data.rate_limit_reached_type ?? null,
  };
}

// ─── Core ───────────────────────────────────────────────────

/**
 * 查询指定账号的额度信息（带内存缓存）。
 *
 * - 缓存命中时直接返回
 * - 同一账号并发调用共享同一个 Promise
 * - 缓存默认 10 分钟，可通过环境变量 QUOTA_CACHE_TTL_MS 调整
 *
 * @param codexHome 账号的 CODEX_HOME 目录
 * @param timeoutMs HTTP 请求超时时间（毫秒），默认 10 秒
 */
export async function probeQuota(
  codexHome: string,
  timeoutMs = 10_000,
): Promise<QuotaInfo | null> {
  // 缓存命中
  const cached = cache.get(codexHome);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  // 并发去重：已有进行中的查询则复用
  const existing = inflight.get(codexHome);
  if (existing) return existing;

  const promise = fetchQuota(codexHome, timeoutMs).finally(() => {
    inflight.delete(codexHome);
  });
  inflight.set(codexHome, promise);
  return promise;
}

/** 强制刷新缓存（跳过缓存直接查询）。 */
export async function refreshQuota(
  codexHome: string,
  timeoutMs = 10_000,
): Promise<QuotaInfo | null> {
  cache.delete(codexHome);
  return probeQuota(codexHome, timeoutMs);
}

/** 通过 HTTP 直接查询配额，结果写入缓存。 */
async function fetchQuota(
  codexHome: string,
  timeoutMs: number,
): Promise<QuotaInfo | null> {
  const token = readAccessToken(codexHome);
  if (!token) {
    logger.warn('quota-probe: no access_token found', { codexHome });
    return null;
  }

  try {
    const res = await fetch(USAGE_URL, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'User-Agent': USER_AGENT,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const isCfChallenge = body.includes('_cf_chl_opt') || body.includes('challenge-platform');
      logger.warn('quota-probe: HTTP error', {
        codexHome,
        status: res.status,
        isCfChallenge,
        bodyPreview: body.substring(0, 200),
      });
      return null;
    }

    const data = (await res.json()) as UsageApiResponse;
    const result = transformResponse(data);

    if (result) {
      cache.set(codexHome, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
      logger.debug('quota-probe: success', {
        codexHome,
        planType: result.planType,
        primaryUsed: `${result.primary.usedPercent}%`,
        ttlMs: CACHE_TTL_MS,
      });
    } else {
      logger.warn('quota-probe: response missing rate_limits', { codexHome });
    }

    return result;
  } catch (err) {
    logger.warn('quota-probe: fetch error', {
      codexHome,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
