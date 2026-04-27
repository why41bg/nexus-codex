import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { loadAccounts, addAccount, updateAccount } from '../services/account-store.js';
import { pool } from '../services/account-pool.js';

const adminRoute = new Hono();

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

export default adminRoute;
