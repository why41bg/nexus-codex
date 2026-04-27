import { randomUUID } from 'node:crypto';
import type {
  ChatMessage,
  ChatCompletionResponse,
  ChatCompletionChunk,
} from '../types.js';

/**
 * 从 messages 数组中提取 prompt 文本。
 * 将 system messages 拼接在前面，取最后一条 user message 作为主体。
 */
export function extractPrompt(messages: ChatMessage[]): string {
  const systemParts = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content);
  const userMessages = messages.filter((m) => m.role === 'user');
  const lastUser = userMessages[userMessages.length - 1]?.content ?? '';

  if (systemParts.length > 0) {
    return `${systemParts.join('\n')}\n\n${lastUser}`;
  }
  return lastUser;
}

/**
 * 生成唯一的 completion ID。
 */
export function generateCompletionId(): string {
  return `chatcmpl-nexus-${randomUUID().slice(0, 12)}`;
}

/**
 * 将 Codex SDK 返回的文本封装为 Chat Completion 响应对象。
 */
export function wrapResponse(
  id: string,
  model: string,
  content: string,
): ChatCompletionResponse {
  return {
    id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
  };
}

/**
 * 将增量内容封装为 Chat Completion Chunk（流式）。
 */
export function wrapChunk(
  id: string,
  model: string,
  delta: { role?: 'assistant'; content?: string },
  finishReason: 'stop' | null = null,
): ChatCompletionChunk {
  return {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason,
      },
    ],
  };
}

/**
 * 将 chunk 格式化为 SSE data 行。
 */
export function formatSSE(chunk: ChatCompletionChunk): string {
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

/**
 * SSE 结束标记。
 */
export const SSE_DONE = 'data: [DONE]\n\n';
