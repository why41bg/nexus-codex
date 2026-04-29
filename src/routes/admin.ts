import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { randomUUID } from 'node:crypto';
import { loadAccounts, addAccount, updateAccount, removeAccount, bulkImportAccounts } from '../services/account-store.js';
import { pool } from '../services/account-pool.js';
import { sessionCount } from '../services/session-store.js';
import { createSession, destroySession } from '../services/session-manager.js';
import { onAdminEvent, type AdminEvent } from '../services/admin-emitter.js';
import { probeQuota, refreshQuota } from '../services/quota-probe.js';
import {
  getDefaultModels,
  addDefaultModel,
  removeDefaultModel,
  getApiKeys,
  findApiKey,
  addApiKey,
  updateApiKey,
  removeApiKey,
  getModelsForKey,
} from '../services/config-store.js';
import { metricsCollector } from '../services/metrics-collector.js';
import { threadPool } from '../services/thread-pool.js';

const adminRoute = new Hono();

// ═══════════════════════════════════════════════════════════════
// SSE stream
// ═══════════════════════════════════════════════════════════════

adminRoute.get('/stream', (c) => {
  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache');
  c.header('Connection', 'keep-alive');
  c.header('X-Accel-Buffering', 'no'); // 禁用 Nginx 缓冲，确保事件实时到达

  const stream = new ReadableStream({
    start(controller) {
      const encode = (event: AdminEvent) =>
        new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);

      // 连接建立时立即推送一次当前快照，让前端无需额外 HTTP 请求即可初始化
      const snapshot: AdminEvent = { type: 'pool_changed' };
      controller.enqueue(encode(snapshot));

      // 订阅后续事件
      const unsubscribe = onAdminEvent((event) => {
        try {
          controller.enqueue(encode(event));
        } catch {
          // 客户端已断开，忽略写入错误
        }
      });

      // 每 25 秒发一次心跳注释，防止代理/浏览器因空闲超时断开连接
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(': heartbeat\n\n'));
        } catch {
          clearInterval(heartbeat);
        }
      }, 25_000);

      // 客户端断开时清理资源
      c.req.raw.signal.addEventListener('abort', () => {
        unsubscribe();
        clearInterval(heartbeat);
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, { headers: c.res.headers });
});

// ═══════════════════════════════════════════════════════════════
// Login verification (Basic Auth already validated by middleware)
// ═══════════════════════════════════════════════════════════════

adminRoute.post('/login', (c) => {
  // 如果请求能到达这里，说明 adminAuthMiddleware 已校验通过
  // 创建会话令牌并返回
  const token = createSession();
  return c.json({ ok: true, token });
});

// ═══════════════════════════════════════════════════════════════
// Logout (destroy session)
// ═══════════════════════════════════════════════════════════════

adminRoute.post('/logout', (c) => {
  const authHeader = c.req.header('Authorization');
  if (authHeader) {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match) {
      destroySession(match[1]);
    }
  }
  return c.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════
// Dashboard
// ═══════════════════════════════════════════════════════════════

adminRoute.get('/dashboard', async (c) => {
  const accounts = await loadAccounts();
  const poolStatus = pool.getStatus();

  const total = accounts.length;
  const enabled = accounts.filter((a) => a.enabled).length;
  const disabled = total - enabled;
  const unhealthy = poolStatus.filter((p) => !p.healthy).length;
  const healthy = poolStatus.filter((p) => p.healthy).length;
  const totalSlots = poolStatus.reduce((sum, p) => sum + p.maxConcurrency, 0);
  const activeSlots = poolStatus.reduce((sum, p) => sum + p.activeCount, 0);
  const availableSlots = totalSlots - activeSlots;
  const totalUsage = accounts.reduce((sum, a) => sum + a.usageCount, 0);

  const recent1h = metricsCollector.getRecentSnapshot(3600_000);

  return c.json({
    total,
    enabled,
    healthy,
    totalSlots,
    activeSlots,
    availableSlots,
    disabled,
    unhealthy,
    totalUsage,
    activeSessions: sessionCount(),
    recentRequests1h: recent1h.requests,
    recentErrors1h: recent1h.errors,
    avgLatency1h: recent1h.avgLatencyMs,
    threadPool: threadPool.getStats(),
  });
});

// ═══════════════════════════════════════════════════════════════
// Metrics (time series & breakdown)
// ═══════════════════════════════════════════════════════════════

adminRoute.get('/metrics/timeseries', (c) => {
  const range = c.req.query('range');
  const validRanges = ['1h', '6h', '24h'] as const;
  const r = validRanges.includes(range as (typeof validRanges)[number])
    ? (range as '1h' | '6h' | '24h')
    : '1h';
  return c.json(metricsCollector.getTimeSeries(r));
});

adminRoute.get('/metrics/breakdown', (c) => {
  const breakdown = metricsCollector.getBreakdown();
  return c.json({
    ...breakdown,
    threadPool: threadPool.getStats(),
  });
});

// ═══════════════════════════════════════════════════════════════
// Account Management
// ═══════════════════════════════════════════════════════════════

adminRoute.get('/accounts', async (c) => {
  const accounts = await loadAccounts();
  const poolStatus = pool.getStatus();

  const merged = accounts.map((acc) => {
    const runtime = poolStatus.find((p) => p.accountId === acc.id);
    return {
      ...acc,
      runtime: runtime
        ? { activeCount: runtime.activeCount, maxConcurrency: runtime.maxConcurrency, healthy: runtime.healthy }
        : { activeCount: 0, maxConcurrency: 0, healthy: false, note: 'not in pool' },
    };
  });

  return c.json({ accounts: merged });
});

const addAccountSchema = z.object({
  codexHome: z.string().min(1, 'codexHome is required'),
  remark: z.string().optional().default(''),
  maxConcurrency: z.number().int().min(1).optional(),
});

adminRoute.post(
  '/accounts',
  zValidator('json', addAccountSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          error: {
            message: result.error.issues.map((i) => i.message).join(', '),
            type: 'invalid_request_error',
            code: 'invalid_request',
          },
        },
        400,
      );
    }
  }),
  async (c) => {
    const body = c.req.valid('json');
    const newAccount = await addAccount(body.codexHome, body.remark, body.maxConcurrency);
    pool.addEntry(newAccount);
    return c.json({ account: newAccount }, 201);
  },
);

const patchAccountSchema = z.object({
  enabled: z.boolean().optional(),
  healthy: z.boolean().optional(),
  remark: z.string().optional(),
  maxConcurrency: z.number().int().min(1).optional(),
});

adminRoute.patch(
  '/accounts/:id',
  zValidator('json', patchAccountSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          error: {
            message: result.error.issues.map((i) => i.message).join(', '),
            type: 'invalid_request_error',
            code: 'invalid_request',
          },
        },
        400,
      );
    }
  }),
  async (c) => {
    const id = c.req.param('id');
    const body = c.req.valid('json');

    const updated = await updateAccount(id, body);
    if (!updated) {
      return c.json(
        {
          error: {
            message: `Account '${id}' not found.`,
            type: 'invalid_request_error',
            code: 'not_found',
          },
        },
        404,
      );
    }

    if (body.enabled === false) {
      pool.removeEntry(id);
    } else if (body.enabled === true) {
      pool.addEntry(updated);
    }
    if (body.healthy !== undefined) {
      pool.updateEntry(id, { healthy: body.healthy });
    }
    if (body.maxConcurrency !== undefined) {
      pool.updateEntry(id, { maxConcurrency: body.maxConcurrency });
    }

    return c.json({ account: updated });
  },
);

adminRoute.delete('/accounts/:id', async (c) => {
  const id = c.req.param('id');

  const poolStatus = pool.getStatus();
  const runtime = poolStatus.find((p) => p.accountId === id);
  if (runtime && runtime.activeCount > 0) {
    return c.json(
      {
        error: {
          message: `Account '${id}' is currently in use (${runtime.activeCount} active). Please try again later.`,
          type: 'invalid_request_error',
          code: 'conflict',
        },
      },
      409,
    );
  }

  const deleted = await removeAccount(id);
  if (!deleted) {
    return c.json(
      {
        error: {
          message: `Account '${id}' not found.`,
          type: 'invalid_request_error',
          code: 'not_found',
        },
      },
      404,
    );
  }

  pool.removeEntry(id);
  return c.json({ deleted: true, id });
});

adminRoute.get('/accounts/:id/quota', async (c) => {
  const id = c.req.param('id');
  const accounts = await loadAccounts();
  const account = accounts.find((a) => a.id === id);
  if (!account) {
    return c.json(
      {
        error: {
          message: `Account '${id}' not found.`,
          type: 'invalid_request_error',
          code: 'not_found',
        },
      },
      404,
    );
  }

  const quota = await probeQuota(account.codexHome);
  if (!quota) {
    return c.json(
      {
        error: {
          message: 'Failed to retrieve quota. The access token may be expired or the API may be unavailable.',
          type: 'server_error',
          code: 'quota_unavailable',
        },
      },
      503,
    );
  }

  return c.json({ quota });
});

adminRoute.post('/accounts/:id/quota/refresh', async (c) => {
  const id = c.req.param('id');
  const accounts = await loadAccounts();
  const account = accounts.find((a) => a.id === id);
  if (!account) {
    return c.json(
      {
        error: {
          message: `Account '${id}' not found.`,
          type: 'invalid_request_error',
          code: 'not_found',
        },
      },
      404,
    );
  }

  const quota = await refreshQuota(account.codexHome);
  if (!quota) {
    return c.json(
      {
        error: {
          message: 'Failed to retrieve quota. The access token may be expired or the API may be unavailable.',
          type: 'server_error',
          code: 'quota_unavailable',
        },
      },
      503,
    );
  }

  return c.json({ quota });
});

// ═══════════════════════════════════════════════════════════════
// Account Import / Export
// ═══════════════════════════════════════════════════════════════

adminRoute.get('/accounts/export', async (c) => {
  const accounts = await loadAccounts();
  const exportData = accounts.map((a) => ({
    id: a.id,
    codexHome: a.codexHome,
    enabled: a.enabled,
    healthy: a.healthy,
    remark: a.remark,
    usageCount: a.usageCount,
    lastUsedAt: a.lastUsedAt,
    maxConcurrency: a.maxConcurrency,
  }));

  const filename = `nexus-codex-accounts-${new Date().toISOString().slice(0, 10)}.json`;
  c.header('Content-Disposition', `attachment; filename="${filename}"`);
  return c.json({ accounts: exportData });
});

const importAccountSchema = z.object({
  codexHome: z.string().min(1, 'codexHome is required'),
  remark: z.string().optional().default(''),
  maxConcurrency: z.number().int().min(1).optional(),
  enabled: z.boolean().optional().default(true),
});

const importRequestSchema = z.object({
  accounts: z.array(importAccountSchema).min(1, 'At least one account is required').max(100, 'Maximum 100 accounts per import'),
  mode: z.enum(['merge', 'replace']),
});

adminRoute.post(
  '/accounts/import',
  zValidator('json', importRequestSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          error: {
            message: result.error.issues.map((i) => `[${i.path.join('.')}] ${i.message}`).join('; '),
            type: 'invalid_request_error',
            code: 'invalid_request',
          },
        },
        400,
      );
    }
  }),
  async (c) => {
    const body = c.req.valid('json');

    // replace 模式下，检查是否有正在使用的账号
    if (body.mode === 'replace') {
      const poolStatus = pool.getStatus();
      const activeCount = poolStatus.reduce((sum, p) => sum + p.activeCount, 0);
      if (activeCount > 0) {
        return c.json(
          {
            error: {
              message: `Cannot replace while ${activeCount} account(s) are in use. Please try again later.`,
              type: 'invalid_request_error',
              code: 'conflict',
            },
          },
          409,
        );
      }
    }

    const result = await bulkImportAccounts(body.accounts, body.mode);

    // 同步到 account pool
    if (body.mode === 'replace') {
      // replace 模式：重新初始化 pool
      const accounts = await loadAccounts();
      pool.init(accounts);
    } else {
      // merge 模式：仅添加新账号到 pool
      for (const acc of result.importedAccounts) {
        pool.addEntry(acc);
      }
    }

    return c.json({
      imported: result.imported,
      skipped: result.skipped,
      errors: result.errors,
    });
  },
);

adminRoute.get('/backup', async (c) => {
  const accounts = await loadAccounts();
  const exportData = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    accounts: accounts.map((a) => ({
      id: a.id,
      codexHome: a.codexHome,
      enabled: a.enabled,
      healthy: a.healthy,
      remark: a.remark,
      usageCount: a.usageCount,
      lastUsedAt: a.lastUsedAt,
      maxConcurrency: a.maxConcurrency,
    })),
    config: {
      defaultModels: getDefaultModels(),
      apiKeys: getApiKeys(),
    },
  };

  const filename = `nexus-codex-backup-${new Date().toISOString().slice(0, 10)}.json`;
  c.header('Content-Disposition', `attachment; filename="${filename}"`);
  return c.json(exportData);
});

// ═══════════════════════════════════════════════════════════════
// Default Models (global whitelist)
// ═══════════════════════════════════════════════════════════════

adminRoute.get('/models', (c) => {
  return c.json({ models: getDefaultModels() });
});

const addModelSchema = z.object({
  model: z.string().min(1, 'model is required'),
});

adminRoute.post(
  '/models',
  zValidator('json', addModelSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          error: {
            message: result.error.issues.map((i) => i.message).join(', '),
            type: 'invalid_request_error',
            code: 'invalid_request',
          },
        },
        400,
      );
    }
  }),
  async (c) => {
    const { model } = c.req.valid('json');
    const added = await addDefaultModel(model);
    if (!added) {
      return c.json(
        {
          error: {
            message: `Model '${model}' already exists in the default list.`,
            type: 'invalid_request_error',
            code: 'conflict',
          },
        },
        409,
      );
    }
    return c.json({ added: true, model, models: getDefaultModels() }, 201);
  },
);

adminRoute.delete('/models/:model', async (c) => {
  const model = c.req.param('model');
  const removed = await removeDefaultModel(model);
  if (!removed) {
    return c.json(
      {
        error: {
          message: `Model '${model}' not found in the default list.`,
          type: 'invalid_request_error',
          code: 'not_found',
        },
      },
      404,
    );
  }
  return c.json({ deleted: true, model, models: getDefaultModels() });
});

// ═══════════════════════════════════════════════════════════════
// API Key Management
// ═══════════════════════════════════════════════════════════════

adminRoute.get('/keys', (c) => {
  // 返回所有 Key（仅脱敏显示，不返回完整 key）
  const keys = getApiKeys().map((k) => ({
    keyMasked: maskKey(k.key),
    keyPrefix: k.key.slice(0, 8),
    name: k.name,
    models: k.models,
    effectiveModels: getModelsForKey(k.key),
    createdAt: k.createdAt,
    expiresAt: k.expiresAt ?? null,
    rateLimitMax: k.rateLimitMax ?? null,
    rateLimitWindowMs: k.rateLimitWindowMs ?? null,
    monthlyQuota: k.monthlyQuota ?? null,
    monthlyUsage: k.monthlyUsage ?? 0,
    ipWhitelist: k.ipWhitelist ?? [],
  }));
  return c.json({ keys });
});

const addKeySchema = z.object({
  key: z.string().optional(),
  name: z.string().optional().default(''),
  models: z.array(z.string()).optional().default([]),
  // 新增权限字段
  expiresAt: z.string().datetime().nullable().optional(),
  rateLimitMax: z.number().int().min(1).nullable().optional(),
  rateLimitWindowMs: z.number().int().min(1000).nullable().optional(),
  monthlyQuota: z.number().int().min(1).nullable().optional(),
  ipWhitelist: z.array(z.string()).optional().default([]),
});

adminRoute.post(
  '/keys',
  zValidator('json', addKeySchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          error: {
            message: result.error.issues.map((i) => i.message).join(', '),
            type: 'invalid_request_error',
            code: 'invalid_request',
          },
        },
        400,
      );
    }
  }),
  async (c) => {
    const body = c.req.valid('json');

    // 自动生成 sk-xxx 格式的 Key（如果未提供）
    const key = body.key?.trim() || generateApiKey();

    if (findApiKey(key)) {
      return c.json(
        {
          error: {
            message: `API key already exists.`,
            type: 'invalid_request_error',
            code: 'conflict',
          },
        },
        409,
      );
    }

    const entry = await addApiKey(key, body.name, body.models, {
      expiresAt: body.expiresAt,
      rateLimitMax: body.rateLimitMax,
      rateLimitWindowMs: body.rateLimitWindowMs,
      monthlyQuota: body.monthlyQuota,
      ipWhitelist: body.ipWhitelist,
    });
    return c.json(
      {
        key: entry.key,
        keyMasked: maskKey(entry.key),
        name: entry.name,
        models: entry.models,
        effectiveModels: getModelsForKey(entry.key),
        createdAt: entry.createdAt,
        expiresAt: entry.expiresAt,
        rateLimitMax: entry.rateLimitMax,
        rateLimitWindowMs: entry.rateLimitWindowMs,
        monthlyQuota: entry.monthlyQuota,
        monthlyUsage: entry.monthlyUsage,
        ipWhitelist: entry.ipWhitelist,
      },
      201,
    );
  },
);

const patchKeySchema = z.object({
  name: z.string().optional(),
  models: z.array(z.string()).optional(),
  // 新增权限字段
  expiresAt: z.string().datetime().nullable().optional(),
  rateLimitMax: z.number().int().min(1).nullable().optional(),
  rateLimitWindowMs: z.number().int().min(1000).nullable().optional(),
  monthlyQuota: z.number().int().min(1).nullable().optional(),
  ipWhitelist: z.array(z.string()).optional(),
});

adminRoute.patch(
  '/keys/:keyPrefix',
  zValidator('json', patchKeySchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          error: {
            message: result.error.issues.map((i) => i.message).join(', '),
            type: 'invalid_request_error',
            code: 'invalid_request',
          },
        },
        400,
      );
    }
  }),
  async (c) => {
    const keyPrefix = c.req.param('keyPrefix');
    const fullKey = resolveKeyByPrefix(keyPrefix);
    if (!fullKey) {
      return c.json(
        { error: { message: 'API key not found.', type: 'invalid_request_error', code: 'not_found' } },
        404,
      );
    }
    const body = c.req.valid('json');

    const updated = await updateApiKey(fullKey, body);
    if (!updated) {
      return c.json(
        { error: { message: 'API key not found.', type: 'invalid_request_error', code: 'not_found' } },
        404,
      );
    }

    return c.json({
      keyMasked: maskKey(updated.key),
      keyPrefix: updated.key.slice(0, 8),
      name: updated.name,
      models: updated.models,
      effectiveModels: getModelsForKey(updated.key),
      createdAt: updated.createdAt,
      expiresAt: updated.expiresAt,
      rateLimitMax: updated.rateLimitMax,
      rateLimitWindowMs: updated.rateLimitWindowMs,
      monthlyQuota: updated.monthlyQuota,
      monthlyUsage: updated.monthlyUsage,
      ipWhitelist: updated.ipWhitelist,
    });
  },
);

adminRoute.delete('/keys/:keyPrefix', async (c) => {
  const keyPrefix = c.req.param('keyPrefix');
  const fullKey = resolveKeyByPrefix(keyPrefix);
  if (!fullKey) {
    return c.json(
      { error: { message: 'API key not found.', type: 'invalid_request_error', code: 'not_found' } },
      404,
    );
  }
  const removed = await removeApiKey(fullKey);
  if (!removed) {
    return c.json(
      { error: { message: 'API key not found.', type: 'invalid_request_error', code: 'not_found' } },
      404,
    );
  }
  return c.json({ deleted: true });
});

// ─── Helpers ────────────────────────────────────────────────

function resolveKeyByPrefix(prefix: string): string | null {
  const keys = getApiKeys();
  const match = keys.find((k) => k.key.startsWith(prefix));
  return match?.key ?? null;
}

function generateApiKey(): string {
  return `sk-${randomUUID().replace(/-/g, '').slice(0, 48)}`;
}

function maskKey(key: string): string {
  if (key.length <= 8) return '****';
  return key.slice(0, 5) + '...' + key.slice(-3);
}

export default adminRoute;
