import type { Codex, Thread } from '@openai/codex-sdk';

// ─── Hono Environment ──────────────────────────────────────

export type AppEnv = {
  Variables: {
    apiKey: string;
  };
};

// ─── Account & Pool ────────────────────────────────────────

export interface Account {
  id: string;
  codexHome: string;
  enabled: boolean;
  healthy: boolean;
  remark: string;
  usageCount: number;
  lastUsedAt: string | null;
  maxConcurrency?: number;           // 单账号最大并发数，缺省取全局默认值
}

export interface PoolEntry {
  accountId: string;
  codex: Codex;
  activeCount: number;               // 当前活跃请求数
  maxConcurrency: number;            // 该账号允许的最大并发数
  healthy: boolean;
}

// ─── Session ───────────────────────────────────────────────

export interface SessionInfo {
  conversationId: string;
  accountId: string;
  thread: Thread;
  lastActiveAt: number;
}

// ─── Chat Completions API ──────────────────────────────────

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
}

export interface ChatCompletionChoice {
  index: number;
  message: {
    role: 'assistant';
    content: string;
  };
  finish_reason: 'stop' | 'length' | null;
}

export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ChatCompletionChunkChoice {
  index: number;
  delta: {
    role?: 'assistant';
    content?: string;
  };
  finish_reason: 'stop' | 'length' | null;
}

export interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: ChatCompletionChunkChoice[];
}

// ─── Responses API ─────────────────────────────────────────

export interface ResponsesInputItem {
  role: 'user' | 'assistant' | 'system' | 'developer';
  content: string | Array<{ type: string; text?: string }>;
}

export interface ResponsesOutput {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<{
    type: 'output_text';
    text: string;
  }>;
}

export interface ResponsesObject {
  id: string;
  object: 'response';
  created_at: number;
  model: string;
  output: ResponsesOutput[];
  status: 'completed' | 'failed' | 'in_progress';
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
}

// ─── Models API ────────────────────────────────────────────

export interface ModelObject {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
}

export interface ModelsListResponse {
  object: 'list';
  data: ModelObject[];
}
