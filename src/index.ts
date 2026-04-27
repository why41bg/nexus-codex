import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { loadAccounts } from './services/account-store.js';
import { pool } from './services/account-pool.js';
import { startSessionCleanup, clearAllSessions, sessionCount } from './services/session-store.js';
import { startHealthCheck } from './services/health-check.js';
import { authMiddleware } from './middleware/auth.js';
import { logRequest } from './utils/logger.js';
import chatCompletionsRoute from './routes/chat-completions.js';
import responsesRoute from './routes/responses.js';
import modelsRoute from './routes/models.js';
import adminRoute from './routes/admin.js';

const app = new Hono();

// ─── Request logger ────────────────────────────────────────
app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  logRequest(c.req.method, c.req.path, c.res.status, Date.now() - start);
});

// ─── Global error handler ──────────────────────────────────
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json(
    {
      error: {
        message: err.message || 'Internal server error',
        type: 'server_error',
        code: 'internal_error',
      },
    },
    500,
  );
});

// ─── 404 handler ───────────────────────────────────────────
app.notFound((c) => {
  return c.json(
    {
      error: {
        message: `The requested endpoint '${c.req.method} ${c.req.path}' does not exist.`,
        type: 'invalid_request_error',
        code: 'not_found',
      },
    },
    404,
  );
});

// ─── Health check (public) ─────────────────────────────────
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    pool: pool.getStatus(),
    sessions: sessionCount(),
  });
});

// ─── Auth middleware for /v1/* and /api/admin/* ─────────────
app.use('/v1/*', authMiddleware);
app.use('/api/admin/*', authMiddleware);

// ─── Routes ────────────────────────────────────────────────
app.route('/v1', chatCompletionsRoute);
app.route('/v1', responsesRoute);
app.route('/v1', modelsRoute);
app.route('/api/admin', adminRoute);

// ─── Timers (stored for cleanup) ───────────────────────────
let sessionCleanupTimer: NodeJS.Timeout | undefined;
let healthCheckTimer: NodeJS.Timeout | undefined;

// ─── Bootstrap ─────────────────────────────────────────────
async function bootstrap() {
  const accounts = await loadAccounts();
  pool.init(accounts);

  // 启动会话超时清理（每 10 分钟扫描，清理 1 小时未活跃的会话）
  sessionCleanupTimer = startSessionCleanup();

  // 启动账号健康检查（每 5 分钟探测一次）
  healthCheckTimer = startHealthCheck();

  const port = Number(process.env.PORT) || 3000;
  const server = serve({ fetch: app.fetch, port }, (info) => {
    console.log(`🚀 Nexus Codex is running on http://localhost:${info.port}`);
  });

  // ─── Graceful shutdown ─────────────────────────────────
  const shutdown = (signal: string) => {
    console.log(`\n📦 Received ${signal}, starting graceful shutdown...`);

    // 停止定时器
    if (sessionCleanupTimer) clearInterval(sessionCleanupTimer);
    if (healthCheckTimer) clearInterval(healthCheckTimer);
    console.log('  ✓ Timers stopped');

    // 清理所有会话，释放账号池资源
    clearAllSessions();
    console.log('  ✓ Sessions cleared');

    // 关闭 HTTP 服务器
    server.close((err) => {
      if (err) {
        console.error('  ✗ Error closing server:', err);
        process.exit(1);
      }
      console.log('  ✓ HTTP server closed');
      console.log('👋 Nexus Codex shut down gracefully');
      process.exit(0);
    });

    // 强制退出超时保护（10 秒）
    setTimeout(() => {
      console.error('  ✗ Graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  console.error('❌ Failed to start Nexus Codex:', err);
  process.exit(1);
});

export default app;
