import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { loadAccounts, addAccount, updateAccount, removeAccount } from '../services/account-store.js';
import { pool } from '../services/account-pool.js';

const adminRoute = new Hono();

// ─── GET /api/admin/dashboard ───────────────────────────────
adminRoute.get('/dashboard', async (c) => {
  const accounts = await loadAccounts();
  const poolStatus = pool.getStatus();

  const total = accounts.length;
  const enabled = accounts.filter((a) => a.enabled).length;
  const disabled = total - enabled;
  const busy = poolStatus.filter((p) => p.busy).length;
  const unhealthy = poolStatus.filter((p) => !p.healthy).length;
  const healthy = poolStatus.filter((p) => p.healthy).length;
  const available = poolStatus.filter((p) => !p.busy && p.healthy).length;
  const totalUsage = accounts.reduce((sum, a) => sum + a.usageCount, 0);

  // sessionCount is exposed via /health; import here for dashboard
  const { sessionCount } = await import('../services/session-store.js');

  return c.json({
    total,
    enabled,
    healthy,
    busy,
    available,
    disabled,
    unhealthy,
    totalUsage,
    activeSessions: sessionCount(),
  });
});

// ─── GET /api/admin/accounts ───────────────────────────────
adminRoute.get('/accounts', async (c) => {
  const accounts = await loadAccounts();
  const poolStatus = pool.getStatus();

  // 合并持久化数据 + 运行时状态
  const merged = accounts.map((acc) => {
    const runtime = poolStatus.find((p) => p.accountId === acc.id);
    return {
      ...acc,
      runtime: runtime
        ? { busy: runtime.busy, healthy: runtime.healthy }
        : { busy: false, healthy: false, note: 'not in pool' },
    };
  });

  return c.json({ accounts: merged });
});

// ─── POST /api/admin/accounts ──────────────────────────────
const addAccountSchema = z.object({
  codexHome: z.string().min(1, 'codexHome is required'),
  remark: z.string().optional().default(''),
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
    const newAccount = await addAccount(body.codexHome, body.remark);

    // 热加载到池中
    pool.addEntry(newAccount);

    return c.json({ account: newAccount }, 201);
  },
);

// ─── PATCH /api/admin/accounts/:id ─────────────────────────
const patchAccountSchema = z.object({
  enabled: z.boolean().optional(),
  healthy: z.boolean().optional(),
  remark: z.string().optional(),
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

    // 同步运行时池状态
    if (body.enabled === false) {
      // 禁用账号：从池中移除
      pool.removeEntry(id);
    } else if (body.enabled === true) {
      // 启用账号：加入池中（如果还不在的话）
      pool.addEntry(updated);
    }
    if (body.healthy !== undefined) {
      pool.updateEntry(id, { healthy: body.healthy });
    }

    return c.json({ account: updated });
  },
);

// ─── DELETE /api/admin/accounts/:id ─────────────────────────
adminRoute.delete('/accounts/:id', async (c) => {
  const id = c.req.param('id');

  // 检查账号是否正在使用中
  const poolStatus = pool.getStatus();
  const runtime = poolStatus.find((p) => p.accountId === id);
  if (runtime?.busy) {
    return c.json(
      {
        error: {
          message: `Account '${id}' is currently busy. Please try again later.`,
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

  // 从运行时池中移除
  pool.removeEntry(id);

  return c.json({ deleted: true, id });
});

export default adminRoute;
