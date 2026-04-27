import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { randomUUID } from 'node:crypto';
import { loadAccounts, addAccount, updateAccount, removeAccount } from '../services/account-store.js';
import { pool } from '../services/account-pool.js';
import { sessionCount } from '../services/session-store.js';
import { createSession, destroySession } from '../services/session-manager.js';
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

const adminRoute = new Hono();

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
  }));
  return c.json({ keys });
});

const addKeySchema = z.object({
  key: z.string().optional(),
  name: z.string().optional().default(''),
  models: z.array(z.string()).optional().default([]),
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

    const entry = await addApiKey(key, body.name, body.models);
    return c.json(
      {
        key: entry.key,
        keyMasked: maskKey(entry.key),
        name: entry.name,
        models: entry.models,
        effectiveModels: getModelsForKey(entry.key),
        createdAt: entry.createdAt,
      },
      201,
    );
  },
);

const patchKeySchema = z.object({
  name: z.string().optional(),
  models: z.array(z.string()).optional(),
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
