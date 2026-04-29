import { Hono } from 'hono';
import type { AppEnv } from '../types.js';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { CreateSessionOptions } from '../services/session-store.js';
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

    // 校验模型白名单
    const modelError = validateModel(c, body.model);
    if (modelError) return modelError;

    // 提取 prompt：如果有 instructions，拼接到前面
    let prompt = extractPromptFromInput(body.input);
    if (body.instructions) {
      prompt = `${body.instructions}\n\n${prompt}`;
    }

    const responseId = generateResponseId();
    const outputItemId = generateOutputItemId();

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
            // 1. response.created
            await s.write(buildResponseCreatedEvent(responseId, body.model));

            // 2. output_item.added
            await s.write(buildOutputItemAddedEvent(responseId, outputItemId));

            // 3. content_part.added
            await s.write(buildContentPartAddedEvent(outputItemId));

            // 4. 流式推送文本增量
            const { controller, cleanup } = createTimeoutController();
            const { events } = await ctx.session.thread.runStreamed(prompt, { signal: controller.signal });
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

            cleanup();

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
            const { message, isTimeout } = formatError(err);
            const errorEvent = `event: error\ndata: ${JSON.stringify({ type: isTimeout ? 'timeout' : 'server_error', message })}\n\n`;
            await s.write(errorEvent);
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

export default responsesRoute;
