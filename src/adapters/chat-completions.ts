import { randomUUID } from 'node:crypto';
import type {
  ChatMessage,
  ChatCompletionResponse,
  ChatCompletionChunk,
} from '../types.js';

/**
 * 从 messages 数组中提取 prompt 文本。
 * 保留完整的多轮对话上下文：system 指令在前，随后按顺序拼接所有
 * user / assistant / tool 消息，以便 Codex SDK 获得尽可能完整的上下文。
 */
export function extractPrompt(messages: ChatMessage[]): string {
  const systemParts: string[] = [];
  const conversationParts: string[] = [];

  for (const m of messages) {
    if (m.role === 'system') {
      systemParts.push(m.content);
    } else if (m.role === 'user') {
      conversationParts.push(`[user]\n${m.content}`);
    } else if (m.role === 'assistant') {
      conversationParts.push(`[assistant]\n${m.content}`);
    } else if (m.role === 'tool') {
      conversationParts.push(`[tool]\n${m.content}`);
    }
  }

  const parts: string[] = [];
  if (systemParts.length > 0) {
    parts.push(systemParts.join('\n'));
  }
  if (conversationParts.length > 0) {
    parts.push(conversationParts.join('\n\n'));
  }
  return parts.join('\n\n');
}

/**
 * 生成唯一的 completion ID。
 */
export function generateCompletionId(): string {
  return `chatcmpl-nexus-${randomUUID()}`;
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
