import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { loadAccounts } from './services/account-store.js';
import { pool } from './services/account-pool.js';
import { startSessionCleanup, clearAllSessions, sessionCount } from './services/session-store.js';
import { startHealthCheck } from './services/health-check.js';
import { loadConfig } from './services/config-store.js';
import { adminAuthMiddleware, apiKeyAuthMiddleware } from './middleware/auth.js';
import { rateLimitMiddleware } from './middleware/rate-limit.js';
import { logger, logRequest } from './utils/logger.js';
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
  // 详细错误仅记录到服务端日志，不暴露给客户端
  logger.error('Unhandled error', { error: err instanceof Error ? err.message : String(err) });
  return c.json(
    {
      error: {
        message: 'An internal server error occurred. Please try again later.',
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

// ─── Admin panel (React SPA) ────────────────────────────────
// Serve static assets under /admin/ (JS, CSS, etc.)
app.use('/admin/*', serveStatic({ root: './public' }));
// Serve index.html for /admin (SPA fallback)
app.get('/admin', serveStatic({ path: './public/admin/index.html' }));

// ─── Auth middleware ─────────────────────────────────────────
// Admin 路由：使用本地配置文件中的账号密码（Basic Auth）
app.use('/api/admin/*', adminAuthMiddleware);
// API 路由：使用 API Key（Bearer Auth）
app.use('/v1/*', apiKeyAuthMiddleware);
// Rate limiting for API routes
app.use('/v1/*', rateLimitMiddleware);

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
  // 加载持久化配置（API Key、模型白名单等）
  await loadConfig();

  const accounts = await loadAccounts();
  pool.init(accounts);

  // 启动会话超时清理（每 10 分钟扫描，清理 1 小时未活跃的会话）
  sessionCleanupTimer = startSessionCleanup();

  // 启动账号健康检查（每 5 分钟探测一次）
  healthCheckTimer = startHealthCheck();

  const port = Number(process.env.PORT) || 3000;
  const server = serve({ fetch: app.fetch, port }, (info) => {
    logger.info('Nexus Codex is running', { port: info.port });
  });

  // ─── Graceful shutdown ─────────────────────────────────
  const shutdown = (signal: string) => {
    logger.info('Starting graceful shutdown', { signal });

    // 停止定时器
    if (sessionCleanupTimer) clearInterval(sessionCleanupTimer);
    if (healthCheckTimer) clearInterval(healthCheckTimer);
    logger.info('Timers stopped');

    // 清理所有会话，释放账号池资源
    clearAllSessions();
    logger.info('Sessions cleared');

    // 关闭 HTTP 服务器
    server.close((err) => {
      if (err) {
        logger.error('Error closing server', { error: err instanceof Error ? err.message : String(err) });
        process.exit(1);
      }
      logger.info('HTTP server closed');
      logger.info('Nexus Codex shut down gracefully');
      process.exit(0);
    });

    // 强制退出超时保护（10 秒）
    setTimeout(() => {
      logger.error('Graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  logger.error('Failed to start Nexus Codex', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});

export default app;
