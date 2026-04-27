import { Hono } from 'hono';
import type { AppEnv } from '../types.js';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { pool } from '../services/account-pool.js';
import { createSession, deleteSession, touchSession, type CreateSessionOptions } from '../services/session-store.js';
import { updateAccount, loadAccounts } from '../services/account-store.js';
import {
  extractPrompt,
  generateCompletionId,
  wrapResponse,
  wrapChunk,
  formatSSE,
  SSE_DONE,
} from '../adapters/chat-completions.js';
import { logAcquire, logRelease, logPoolExhausted } from '../utils/logger.js';
import { isModelAllowedForKey } from '../services/config-store.js';
import { stream } from 'hono/streaming';

/** 单次请求超时（毫秒），默认 5 分钟 */
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS) || 5 * 60 * 1000;

// ─── Request validation schema ─────────────────────────────
const REASONING_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh'] as const;

const chatCompletionSchema = z.object({
  model: z.string(),
  messages: z.array(
    z.object({
      role: z.enum(['system', 'user', 'assistant', 'tool']),
      content: z.string(),
      name: z.string().optional(),
    }),
  ),
  stream: z.boolean().optional().default(false),
  temperature: z.number().optional(),
  max_tokens: z.number().optional(),
  reasoning_effort: z.enum(REASONING_EFFORTS).optional(),
});

const chatCompletionsRoute = new Hono<AppEnv>();

chatCompletionsRoute.post(
  '/chat/completions',
  zValidator('json', chatCompletionSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          error: {
            message: `Invalid request: ${result.error.issues.map((i) => i.message).join(', ')}`,
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
    // 校验模型是否在白名单中
    const apiKey = c.get('apiKey');
    if (!isModelAllowedForKey(apiKey, body.model)) {
      return c.json(
        {
          error: {
            message: `The model '${body.model}' does not exist or is not available. Check /v1/models for available models.`,
            type: 'invalid_request_error',
            code: 'model_not_found',
          },
        },
        404,
      );
    }

    const prompt = extractPrompt(body.messages);
    const completionId = generateCompletionId();

    // 从账号池获取一个可用账号（排队等待）
    const entry = await pool.acquireAsync();
    if (!entry) {
      logPoolExhausted();
      return c.json(
        {
          error: {
            message: 'All accounts are currently busy. Please try again later.',
            type: 'rate_limit_error',
            code: 'rate_limit_exceeded',
          },
        },
        429,
      );
    }

    const reqStart = Date.now();
    logAcquire(entry.accountId);

    try {
      // 创建临时会话，透传 model 和 reasoning_effort
      const sessionOpts: CreateSessionOptions = {
        model: body.model,
        ...(body.reasoning_effort && { modelReasoningEffort: body.reasoning_effort }),
      };
      const session = createSession(entry.accountId, entry.codex, sessionOpts);

      // 更新使用统计（异步，不阻塞请求处理）
      loadAccounts().then((accounts) => {
        const acc = accounts.find((a) => a.id === entry.accountId);
        if (acc) {
          updateAccount(acc.id, {
            usageCount: acc.usageCount + 1,
            lastUsedAt: new Date().toISOString(),
          });
        }
      });

      if (body.stream) {
        // ─── 流式响应 ──────────────────────────────────────
        return stream(c, async (s) => {
          c.header('Content-Type', 'text/event-stream');
          c.header('Cache-Control', 'no-cache');
          c.header('Connection', 'keep-alive');

          try {
            // 发送初始 chunk（role）
            const initChunk = wrapChunk(completionId, body.model, { role: 'assistant' });
            await s.write(formatSSE(initChunk));

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

            const { events } = await session.thread.runStreamed(prompt, { signal: controller.signal });
            let fullContent = '';

            for await (const event of events) {
              if (event.type === 'item.updated' || event.type === 'item.completed') {
                if (event.item.type === 'agent_message') {
                  // 计算增量：SDK 的 item.updated 每次都返回完整文本
                  const newContent = event.item.text;
                  if (newContent.length > fullContent.length) {
                    const delta = newContent.slice(fullContent.length);
                    fullContent = newContent;
                    const chunk = wrapChunk(completionId, body.model, { content: delta });
                    await s.write(formatSSE(chunk));
                  }
                }
              }

              if (event.type === 'turn.failed') {
                const errorChunk = `data: ${JSON.stringify({ error: { message: event.error.message, type: 'server_error', code: 'internal_error' } })}\n\n`;
                await s.write(errorChunk);
                break;
              }
            }

            clearTimeout(timeoutId);

            // 发送结束 chunk
            const stopChunk = wrapChunk(completionId, body.model, {}, 'stop');
            await s.write(formatSSE(stopChunk));
            await s.write(SSE_DONE);
          } catch (err) {
            const isTimeout = err instanceof Error && err.name === 'AbortError';
            const errMsg = isTimeout
              ? 'Request timed out'
              : err instanceof Error ? err.message : 'Unknown error';
            const errorData = `data: ${JSON.stringify({ error: { message: errMsg, type: 'server_error', code: isTimeout ? 'timeout' : 'internal_error' } })}\n\n`;
            await s.write(errorData);
            await s.write(SSE_DONE);
          } finally {
            deleteSession(session.conversationId);
            logRelease(entry.accountId, Date.now() - reqStart);
          }
        });
      } else {
        // ─── 非流式响应 ────────────────────────────────────
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
          const turn = await session.thread.run(prompt, { signal: controller.signal });
          clearTimeout(timeoutId);
          const content = turn.finalResponse ?? '';
          const response = wrapResponse(completionId, body.model, content);

          // 填入 usage（如果 SDK 返回了的话）
          if (turn.usage) {
            response.usage = {
              prompt_tokens: turn.usage.input_tokens,
              completion_tokens: turn.usage.output_tokens,
              total_tokens: turn.usage.input_tokens + turn.usage.output_tokens,
            };
          }

          return c.json(response);
        } finally {
          deleteSession(session.conversationId);
          logRelease(entry.accountId, Date.now() - reqStart);
        }
      }
    } catch (err) {
      // 确保异常时释放账号
      pool.release(entry.accountId);
      logRelease(entry.accountId, Date.now() - reqStart, err instanceof Error ? err.message : 'unknown error');
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      return c.json(
        {
          error: {
            message: errMsg,
            type: 'server_error',
            code: 'internal_error',
          },
        },
        500,
      );
    }
  },
);

export default chatCompletionsRoute;
