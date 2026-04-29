import { randomUUID } from 'node:crypto';
import type { ResponsesInputItem, ResponsesObject } from '../types.js';

/**
 * 从 Responses API 的 input 字段中提取用户文本。
 * input 可以是纯字符串，也可以是 InputItem 数组。
 */
export function extractPromptFromInput(input: string | ResponsesInputItem[]): string {
  // 纯字符串输入
  if (typeof input === 'string') {
    return input;
  }

  // 数组输入：收集 system/developer 指令和所有 user message
  const systemParts: string[] = [];
  const userParts: string[] = [];

  for (const item of input) {
    const text = extractTextFromContent(item.content);

    if (item.role === 'system' || item.role === 'developer') {
      systemParts.push(text);
    } else if (item.role === 'user') {
      userParts.push(text);
    }
  }

  const userText = userParts.join('\n');
  if (systemParts.length > 0) {
    return `${systemParts.join('\n')}\n\n${userText}`;
  }
  return userText;
}

/**
 * 从 content 字段中提取文本。
 * content 可以是纯字符串或 ContentPart 数组。
 */
function extractTextFromContent(content: string | Array<{ type: string; text?: string }>): string {
  if (typeof content === 'string') {
    return content;
  }
  return content
    .filter((part) => part.type === 'input_text' || part.type === 'text')
    .map((part) => part.text ?? '')
    .join('\n');
}

/**
 * 生成唯一的 response ID。
 */
export function generateResponseId(): string {
  return `resp-nexus-${randomUUID()}`;
}

/**
 * 生成唯一的 output item ID。
 */
export function generateOutputItemId(): string {
  return `msg-nexus-${randomUUID()}`;
}

/**
 * 将 Codex SDK 返回的文本封装为 Responses API 的标准响应对象（非流式）。
 */
export function wrapResponseObject(
  id: string,
  model: string,
  content: string,
  inputTokens: number = 0,
  outputTokens: number = 0,
): ResponsesObject {
  return {
    id,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    model,
    output: [
      {
        id: generateOutputItemId(),
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: content,
          },
        ],
      },
    ],
    status: 'completed',
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
    },
  };
}

// ─── Streaming event builders ──────────────────────────────

/**
 * 构建 response.created 事件（流的起始事件）。
 */
export function buildResponseCreatedEvent(id: string, model: string): string {
  const event = {
    type: 'response.created',
    response: {
      id,
      object: 'response',
      created_at: Math.floor(Date.now() / 1000),
      model,
      output: [],
      status: 'in_progress',
    },
  };
  return `event: response.created\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * 构建 response.output_item.added 事件。
 */
export function buildOutputItemAddedEvent(responseId: string, itemId: string): string {
  const event = {
    type: 'response.output_item.added',
    output_index: 0,
    item: {
      id: itemId,
      type: 'message',
      role: 'assistant',
      content: [],
    },
  };
  return `event: response.output_item.added\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * 构建 response.content_part.added 事件。
 */
export function buildContentPartAddedEvent(itemId: string): string {
  const event = {
    type: 'response.content_part.added',
    output_index: 0,
    content_index: 0,
    part: { type: 'output_text', text: '' },
  };
  return `event: response.content_part.added\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * 构建 response.output_text.delta 事件（文本增量）。
 */
export function buildTextDeltaEvent(delta: string): string {
  const event = {
    type: 'response.output_text.delta',
    output_index: 0,
    content_index: 0,
    delta,
  };
  return `event: response.output_text.delta\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * 构建 response.output_text.done 事件。
 */
export function buildTextDoneEvent(text: string): string {
  const event = {
    type: 'response.output_text.done',
    output_index: 0,
    content_index: 0,
    text,
  };
  return `event: response.output_text.done\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * 构建 response.content_part.done 事件。
 */
export function buildContentPartDoneEvent(text: string): string {
  const event = {
    type: 'response.content_part.done',
    output_index: 0,
    content_index: 0,
    part: { type: 'output_text', text },
  };
  return `event: response.content_part.done\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * 构建 response.output_item.done 事件。
 */
export function buildOutputItemDoneEvent(itemId: string, text: string): string {
  const event = {
    type: 'response.output_item.done',
    output_index: 0,
    item: {
      id: itemId,
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text }],
    },
  };
  return `event: response.output_item.done\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * 构建 response.completed 事件（流的终结事件）。
 */
export function buildResponseCompletedEvent(
  id: string,
  model: string,
  itemId: string,
  text: string,
  inputTokens: number = 0,
  outputTokens: number = 0,
): string {
  const event = {
    type: 'response.completed',
    response: {
      id,
      object: 'response',
      created_at: Math.floor(Date.now() / 1000),
      model,
      output: [
        {
          id: itemId,
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text }],
        },
      ],
      status: 'completed',
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
      },
    },
  };
  return `event: response.completed\ndata: ${JSON.stringify(event)}\n\n`;
}
