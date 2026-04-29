import { Hono } from 'hono';
import type { AppEnv } from '../types.js';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { CreateSessionOptions } from '../services/session-store.js';
import {
  extractPrompt,
  generateCompletionId,
  wrapResponse,
  wrapChunk,
  formatSSE,
  SSE_DONE,
} from '../adapters/chat-completions.js';
import { stream } from 'hono/streaming';
import {
  validateModel,
  acquireAccount,
  initRequestContext,
  releaseRequestContext,
  releaseAccountOnError,
  createTimeoutController,
  formatError,
} from '../utils/request-lifecycle.js';

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

    // 校验模型白名单
    const modelError = validateModel(c, body.model);
    if (modelError) return modelError;

    const prompt = extractPrompt(body.messages);
    const completionId = generateCompletionId();

    // 从账号池获取可用账号
    const result = await acquireAccount(c);
    if ('error' in result) return result.error;
    const { entry } = result;

    try {
      // 初始化请求上下文（创建会话 + 触发使用统计）
      const sessionOpts: CreateSessionOptions = {
        model: body.model,
        ...(body.reasoning_effort && { modelReasoningEffort: body.reasoning_effort }),
      };
      const ctx = initRequestContext(entry, sessionOpts);

      if (body.stream) {
        // ─── 流式响应 ──────────────────────────────────────
        c.header('Content-Type', 'text/event-stream');
        c.header('Cache-Control', 'no-cache');
        c.header('Connection', 'keep-alive');
        return stream(c, async (s) => {
          try {
            // 发送初始 chunk（role）
            const initChunk = wrapChunk(completionId, body.model, { role: 'assistant' });
            await s.write(formatSSE(initChunk));

            const { controller, cleanup } = createTimeoutController();
            const { events } = await ctx.session.thread.runStreamed(prompt, { signal: controller.signal });
            let fullContent = '';

            for await (const event of events) {
              if (event.type === 'item.updated' || event.type === 'item.completed') {
                if (event.item.type === 'agent_message') {
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

            cleanup();

            // 发送结束 chunk
            const stopChunk = wrapChunk(completionId, body.model, {}, 'stop');
            await s.write(formatSSE(stopChunk));
            await s.write(SSE_DONE);
          } catch (err) {
            const { message, isTimeout } = formatError(err);
            const errorData = `data: ${JSON.stringify({ error: { message, type: 'server_error', code: isTimeout ? 'timeout' : 'internal_error' } })}\n\n`;
            await s.write(errorData);
            await s.write(SSE_DONE);
          } finally {
            releaseRequestContext(ctx);
          }
        });
      } else {
        // ─── 非流式响应 ────────────────────────────────────
        try {
          const { controller, cleanup } = createTimeoutController();
          const turn = await ctx.session.thread.run(prompt, { signal: controller.signal });
          cleanup();
          const content = turn.finalResponse ?? '';
          const response = wrapResponse(completionId, body.model, content);

          if (turn.usage) {
            response.usage = {
              prompt_tokens: turn.usage.input_tokens,
              completion_tokens: turn.usage.output_tokens,
              total_tokens: turn.usage.input_tokens + turn.usage.output_tokens,
            };
          }

          return c.json(response);
        } finally {
          releaseRequestContext(ctx);
        }
      }
    } catch (err) {
      releaseAccountOnError(entry, Date.now(), err);
      const { message } = formatError(err);
      return c.json(
        {
          error: {
            message,
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
