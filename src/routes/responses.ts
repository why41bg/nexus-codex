import { Hono } from 'hono';
import type { AppEnv } from '../types.js';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { pool } from '../services/account-pool.js';
import { createSession, deleteSession, type CreateSessionOptions } from '../services/session-store.js';
import { updateAccount, loadAccounts } from '../services/account-store.js';
import {
  extractPromptFromInput,
  generateResponseId,
  generateOutputItemId,
  wrapResponseObject,
  buildResponseCreatedEvent,
  buildOutputItemAddedEvent,
  buildContentPartAddedEvent,
  buildTextDeltaEvent,
  buildTextDoneEvent,
  buildContentPartDoneEvent,
  buildOutputItemDoneEvent,
  buildResponseCompletedEvent,
} from '../adapters/responses.js';
import { logAcquire, logRelease, logPoolExhausted } from '../utils/logger.js';
import { isModelAllowedForKey } from '../services/config-store.js';
import { stream } from 'hono/streaming';

/** 单次请求超时（毫秒），默认 5 分钟 */
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS) || 5 * 60 * 1000;

// ─── Request validation schema ─────────────────────────────
const contentPartSchema = z.object({
  type: z.string(),
  text: z.string().optional(),
});

const inputItemSchema = z.object({
  role: z.enum(['user', 'assistant', 'system', 'developer']),
  content: z.union([z.string(), z.array(contentPartSchema)]),
});

const REASONING_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh'] as const;

const responsesSchema = z.object({
  model: z.string(),
  input: z.union([z.string(), z.array(inputItemSchema)]),
  stream: z.boolean().optional().default(false),
  temperature: z.number().optional(),
  max_output_tokens: z.number().optional(),
  previous_response_id: z.string().optional(),
  instructions: z.string().optional(),
  store: z.boolean().optional(),
  reasoning_effort: z.enum(REASONING_EFFORTS).optional(),
});

const responsesRoute = new Hono<AppEnv>();

responsesRoute.post(
  '/responses',
  zValidator('json', responsesSchema, (result, c) => {
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

    // 提取 prompt：如果有 instructions，拼接到前面
    let prompt = extractPromptFromInput(body.input);
    if (body.instructions) {
      prompt = `${body.instructions}\n\n${prompt}`;
    }

    const responseId = generateResponseId();
    const outputItemId = generateOutputItemId();

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
            // 1. response.created
            await s.write(buildResponseCreatedEvent(responseId, body.model));

            // 2. output_item.added
            await s.write(buildOutputItemAddedEvent(responseId, outputItemId));

            // 3. content_part.added
            await s.write(buildContentPartAddedEvent(outputItemId));

            // 4. 流式推送文本增量
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

            const { events } = await session.thread.runStreamed(prompt, { signal: controller.signal });
            let fullContent = '';
            let inputTokens = 0;
            let outputTokens = 0;

            for await (const event of events) {
              if (event.type === 'item.updated' || event.type === 'item.completed') {
                if (event.item.type === 'agent_message') {
                  const newContent = event.item.text;
                  if (newContent.length > fullContent.length) {
                    const delta = newContent.slice(fullContent.length);
                    fullContent = newContent;
                    await s.write(buildTextDeltaEvent(delta));
                  }
                }
              }

              if (event.type === 'turn.completed' && event.usage) {
                inputTokens = event.usage.input_tokens;
                outputTokens = event.usage.output_tokens;
              }

              if (event.type === 'turn.failed') {
                const errorEvent = `event: error\ndata: ${JSON.stringify({ type: 'server_error', message: event.error.message })}\n\n`;
                await s.write(errorEvent);
                break;
              }
            }

            clearTimeout(timeoutId);

            // 5. 结束事件序列
            await s.write(buildTextDoneEvent(fullContent));
            await s.write(buildContentPartDoneEvent(fullContent));
            await s.write(buildOutputItemDoneEvent(outputItemId, fullContent));
            await s.write(
              buildResponseCompletedEvent(
                responseId,
                body.model,
                outputItemId,
                fullContent,
                inputTokens,
                outputTokens,
              ),
            );
          } catch (err) {
            const isTimeout = err instanceof Error && err.name === 'AbortError';
            const errMsg = isTimeout
              ? 'Request timed out'
              : err instanceof Error ? err.message : 'Unknown error';
            const errorEvent = `event: error\ndata: ${JSON.stringify({ type: isTimeout ? 'timeout' : 'server_error', message: errMsg })}\n\n`;
            await s.write(errorEvent);
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

          const inputTokens = turn.usage?.input_tokens ?? 0;
          const outputTokens = turn.usage?.output_tokens ?? 0;

          const response = wrapResponseObject(
            responseId,
            body.model,
            content,
            inputTokens,
            outputTokens,
          );
          return c.json(response);
        } finally {
          deleteSession(session.conversationId);
          logRelease(entry.accountId, Date.now() - reqStart);
        }
      }
    } catch (err) {
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

export default responsesRoute;
