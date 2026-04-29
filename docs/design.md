# Nexus Codex 设计方案

## 项目概述

**Nexus Codex** 是一个 OpenAI API 兼容的 Codex 账号池网关。它在后端统一调度多个 ChatGPT Plus 账号的 Codex CLI 实例，对外暴露标准的 OpenAI API 接口（`/v1/chat/completions`、`/v1/responses`、`/v1/models`）。用户只需在 Codex CLI、opencode 或任何 OpenAI SDK 兼容客户端中将 `base_url` 指向本服务，即可像调用 OpenAI 官方 API 一样透明地使用，无需感知底层的多账号调度。

> 名称释义：Nexus（连接枢纽）+ Codex（OpenAI Codex CLI），寓意将多个 Codex 账号连接为一个统一的 API 枢纽。

---

## 使用方式

### Codex CLI 接入

Codex CLI 新版（≥0.123.0）强制使用 Responses API 格式。在 `~/.codex/config.toml` 中配置自定义 Provider 即可：

```toml
model = "codex-mini"
model_provider = "nexus"

[model_providers.nexus]
base_url = "http://localhost:3000/v1"
wire_api = "responses"
env_key = "NEXUS_API_KEY"
```

然后设置环境变量：

```bash
export NEXUS_API_KEY="your-api-key"
codex --provider nexus "你的问题"
```

### opencode 接入

opencode 基于 AI SDK，走 Chat Completions 格式。在项目根目录创建 `opencode.json`：

```json
{
  "provider": {
    "nexus": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "http://localhost:3000/v1",
        "apiKey": "your-api-key"
      },
      "models": {
        "codex-mini": {}
      }
    }
  }
}
```

### 通用 OpenAI SDK 接入

任何兼容 OpenAI API 的客户端或 SDK 均可直接对接：

```python
# Python 示例
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="your-api-key",
)

response = client.chat.completions.create(
    model="codex-mini",
    messages=[{"role": "user", "content": "Hello!"}],
    stream=True,
)
for chunk in response:
    print(chunk.choices[0].delta.content, end="")
```

```bash
# curl 示例
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"codex-mini","messages":[{"role":"user","content":"Hello!"}]}'
```

---

## 技术选型

### 运行时 & 语言

**Node.js 18+ / TypeScript**，理由如下：

- `@openai/codex-sdk` 是官方提供的 TypeScript SDK，直接封装了进程管理、JSONL 解析、会话恢复等所有底层细节，无需手写 `ProcessBuilder`
- Codex CLI 本身是 Node.js 生态工具，同语言栈调用天然顺手，无阻抗
- TypeScript 提供完整的类型安全，SDK 的事件类型、Thread/Turn API 均有完整类型定义

### Web 框架：Hono

在 Express / Fastify / Hono 三者中选择 **Hono**，理由：

- **TypeScript 原生**：类型推断开箱即用，无需手动标注 req/res 类型
- **轻量**：仅 ~14kB，无多余依赖，启动极快
- **API 简洁**：Express 风格，学习成本低
- **内置中间件齐全**：cors、logger、jwt、rate-limiter 均内置，无需额外安装
- **Zod 集成**：`@hono/zod-validator` 一行代码完成请求校验并自动推断类型

Fastify 性能更高（~77K req/s vs Hono ~45K req/s），但对于账号池这个场景，瓶颈在 Codex CLI 的响应速度而非 HTTP 框架，Hono 的简洁性更有价值。

### 存储

- **账号信息**：JSON 文件（`data/accounts.json`）。账号数量少，无需引入数据库
- **会话绑定**：内存 Map（`Map<conversationId, SessionInfo>`）。服务重启会话自然失效，符合预期

---

## 核心原理

### `@openai/codex-sdk` 的能力

官方 TypeScript SDK（`@openai/codex-sdk`）完整封装了 `codex exec` 的所有能力，提供三层抽象：

**`Codex` 类**：入口，管理 CLI 进程配置和环境变量

```typescript
const codex = new Codex({
  env: { CODEX_HOME: '/path/to/account-dir' }, // 多账号隔离的关键
});
```

**`Thread` 类**：代表一个持久会话，对应一个 `codex exec` session

```typescript
const thread = codex.startThread({ skipGitRepoCheck: true });
const turn = await thread.run('你的问题');
console.log(turn.finalResponse); // 直接拿到最终回答，无需解析 JSONL
```

**流式响应**：通过 `runStreamed()` 返回 `AsyncGenerator<ThreadEvent>`，支持实时推送

```typescript
const { events } = await thread.runStreamed('你的问题');
for await (const event of events) {
  if (event.type === 'item.completed') { /* 实时处理 */ }
  if (event.type === 'turn.completed') { /* 结束 */ }
}
```

**多轮对话**：在同一个 `Thread` 实例上反复调用 `run()`，上下文自动保持

```typescript
await thread.run('第一轮问题');
await thread.run('继续追问'); // 上下文连续
```

**会话恢复**：通过 `thread_id` 跨进程恢复会话（存储在 `CODEX_HOME/sessions/`）

```typescript
const thread = codex.resumeThread(savedThreadId);
```

### `CODEX_HOME` 多账号隔离

Codex CLI 的所有配置和认证信息（`config.toml`、`auth.json`）均存储在 `CODEX_HOME` 目录下，默认为 `~/.codex`。通过为每个账号指定独立目录，完美隔离多账号 session：

```
~/.codex-pool/
├── account-1/   ← CODEX_HOME for 账号A（auth.json 存储 OAuth Token）
├── account-2/   ← CODEX_HOME for 账号B
└── account-3/   ← CODEX_HOME for 账号C
```

每个目录提前用对应账号执行一次 `CODEX_HOME=<dir> codex login`，后续 OAuth Token 由 SDK 自动刷新。

---

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                      上层调用方                               │
│   Codex CLI          opencode         OpenAI SDK / curl      │
│  (Responses API)  (Chat Completions)  (Chat Completions)     │
└──────────┬───────────────┬───────────────┬──────────────────┘
           │               │               │
           │   HTTP / SSE (OpenAI 兼容协议)  │
           └───────────────┼───────────────┘
┌──────────────────────────▼──────────────────────────────────┐
│              Nexus Codex API 网关 (Hono)                      │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                  协议适配层                            │   │
│  │  /v1/chat/completions  ──┐                           │   │
│  │  /v1/responses          ─┼─→  统一内部调用格式         │   │
│  │  /v1/models             ─┘                           │   │
│  └──────────────────────────┬───────────────────────────┘   │
│                              │                               │
│  ┌────────────┐  ┌──────────▼───┐  ┌────────────────────┐  │
│  │  API Key   │  │  账号池调度层  │  │  会话管理层         │  │
│  │  鉴权中间件 │  │ (轮询/空闲)  │  │ (内存 Map, 超时清理)│  │
│  └────────────┘  └──────────┬───┘  └────────────────────┘  │
│                              │                               │
│              ┌───────────────▼──────────────┐               │
│              │      AccountPoolService       │               │
│              │     (@openai/codex-sdk)       │               │
│              └───────────────┬──────────────┘               │
└──────────────────────────────┼──────────────────────────────┘
                               │ SDK 调用（内部管理子进程）
            ┌──────────────────┼──────────────────┐
            │                  │                  │
┌───────────▼────────┐ ┌──────▼───────┐ ┌────────▼─────────┐
│   Codex 实例 A     │ │ Codex 实例 B │ │   Codex 实例 C   │
│ CODEX_HOME=        │ │ CODEX_HOME=  │ │ CODEX_HOME=      │
│ ~/.codex-pool/     │ │ ~/.codex-pool│ │ ~/.codex-pool/   │
│ account-1          │ │ /account-2   │ │ account-3        │
└────────────────────┘ └──────────────┘ └──────────────────┘
```

---

## 详细设计

### 1. 账号管理

账号信息持久化在 `data/accounts.json`：

```json
[
  {
    "id": "acc-1",
    "codexHome": "/Users/you/.codex-pool/account-1",
    "enabled": true,
    "healthy": true,
    "remark": "account-a@gmail.com",
    "usageCount": 0,
    "lastUsedAt": null
  }
]
```

账号初始化流程（一次性手动操作）：

```bash
# 为每个账号创建独立目录并登录
CODEX_HOME=~/.codex-pool/account-1 codex login
CODEX_HOME=~/.codex-pool/account-2 codex login
```

登录完成后，将账号信息录入 `data/accounts.json`，`enabled: true`。

### 2. 账号池与路由调度

服务启动时，为每个 `enabled` 账号预初始化一个 `Codex` SDK 实例，存入内存池：

```typescript
// account-pool.ts
import { Codex } from '@openai/codex-sdk';

interface PoolEntry {
  accountId: string;
  codexHome: string;        // CODEX_HOME 目录路径
  codex: Codex;
  activeCount: number;      // 当前活跃请求数
  maxConcurrency: number;   // 该账号允许的最大并发数
  healthy: boolean;
}

class AccountPool {
  private pool: PoolEntry[] = [];
  private counter = 0;

  init(accounts: Account[]) {
    this.pool = accounts
      .filter(a => a.enabled)
      .map(a => ({
        accountId: a.id,
        codex: new Codex({ env: { CODEX_HOME: a.codexHome } }),
        activeCount: 0,
        maxConcurrency: a.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY,
        healthy: true,
      }));
  }

  // 最小负载优先选取可用账号
  acquire(): PoolEntry | null {
    const available = this.pool
      .filter(e => e.healthy && e.activeCount < e.maxConcurrency)
      .sort((a, b) => a.activeCount - b.activeCount);
    if (available.length === 0) return null;
    const entry = available[0];
    entry.activeCount++;
    return entry;
  }

  release(accountId: string) {
    const entry = this.pool.find(e => e.accountId === accountId);
    if (entry) entry.activeCount = Math.max(0, entry.activeCount - 1);
  }
}
```

### 3. 会话管理

OpenAI API 本身是无状态的（每次请求携带完整 messages 历史），但底层 Codex SDK 的 Thread 是有状态的。网关需要在两者之间做桥接：

```typescript
// session-store.ts
interface SessionInfo {
  conversationId: string;   // 由 messages 指纹或首条 message 哈希生成
  accountId: string;
  thread: Thread;           // SDK Thread 实例，持有多轮上下文
  lastActiveAt: number;
}

const sessions = new Map<string, SessionInfo>();
```

对于无状态的单轮请求（每次都是全新 messages），网关每次创建临时 Thread，调用完毕即释放账号。对于 Codex CLI 这类会持续追加 messages 的客户端，网关可根据请求特征（如 `previous_response_id`）复用已有 Thread。

### 4. 对外 API 设计

网关对外暴露三组接口：OpenAI 兼容 API、Admin 管理 API、健康探针。

#### OpenAI 兼容 API（核心）

```
POST /v1/chat/completions
  Headers: Authorization: Bearer <API_KEY>
  Body: OpenAI Chat Completions 标准请求格式，支持 reasoning_effort 参数
  ⚠ model 字段须在模型白名单中，否则返回 404
  → 非流式：返回 Chat Completion 对象
  → 流式（stream: true）：SSE 推送 Chat Completion Chunk，以 data: [DONE] 结束

POST /v1/responses
  Headers: Authorization: Bearer <API_KEY>
  Body: OpenAI Responses API 标准请求格式，支持 reasoning_effort 参数
  ⚠ model 字段须在模型白名单中，否则返回 404
  → 非流式：返回 Response 对象
  → 流式（stream: true）：SSE 推送 Response 事件流

GET /v1/models
  Headers: Authorization: Bearer <API_KEY>
  → 返回模型白名单列表（通过管理面板或 Admin API 配置）

GET /v1/models/:modelId
  Headers: Authorization: Bearer <API_KEY>
  → 返回单个模型详情，模型不在白名单中返回 404
```

> **模型白名单校验**：模型白名单通过管理面板或 Admin API 配置，持久化在 `data/config.json` 中。`/v1/chat/completions` 和 `/v1/responses` 在处理请求前会检查 `model` 字段是否在白名单中，不在则返回 404（`code: model_not_found`）。白名单逻辑由 `src/services/config-store.ts` 统一提供，所有路由共用。

#### Chat Completions 请求/响应格式

请求体：

```json
{
  "model": "codex-mini",
  "messages": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "Hello!"}
  ],
  "stream": false,
  "reasoning_effort": "high"
}
```

非流式响应：

```json
{
  "id": "chatcmpl-nexus-xxxxx",
  "object": "chat.completion",
  "created": 1700000000,
  "model": "codex-mini",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "你好！有什么可以帮助你的？"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 0,
    "completion_tokens": 0,
    "total_tokens": 0
  }
}
```

流式响应（`stream: true`）：

```
data: {"id":"chatcmpl-nexus-xxxxx","object":"chat.completion.chunk","created":1700000000,"model":"codex-mini","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}

data: {"id":"chatcmpl-nexus-xxxxx","object":"chat.completion.chunk","created":1700000000,"model":"codex-mini","choices":[{"index":0,"delta":{"content":"你好"},"finish_reason":null}]}

data: {"id":"chatcmpl-nexus-xxxxx","object":"chat.completion.chunk","created":1700000000,"model":"codex-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

#### Responses API 请求/响应格式

请求体：

```json
{
  "model": "codex-mini",
  "input": [
    {
      "role": "user",
      "content": [{"type": "input_text", "text": "Hello!"}]
    }
  ],
  "stream": true,
  "reasoning_effort": "high"
}
```

网关内部将 Responses API 的 `input` 格式转换为 Codex SDK 可识别的调用，再将 SDK 返回的结果封装为 Responses API 的标准响应事件流推送给客户端。

#### Models API 响应格式

```json
{
  "object": "list",
  "data": [
    {
      "id": "codex-mini",
      "object": "model",
      "created": 1700000000,
      "owned_by": "nexus-codex"
    }
  ]
}
```

#### Admin 管理 API

```
POST   /api/admin/login           → 登录（Basic Auth），返回 session token
POST   /api/admin/logout          → 登出，销毁 session

GET    /api/admin/dashboard       → 账号池概览数据
GET    /api/admin/accounts        → 查看所有账号及运行时状态（activeCount、maxConcurrency、healthy）
POST   /api/admin/accounts        → 添加账号 { "codexHome": "...", "remark": "...", "maxConcurrency": 3 }
PATCH  /api/admin/accounts/:id    → 启用/禁用账号 { "enabled": true/false }
DELETE /api/admin/accounts/:id    → 删除账号

GET    /api/admin/models          → 查看当前模型白名单
POST   /api/admin/models          → 添加模型 { "model": "codex-plus" }，已存在返回 409
DELETE /api/admin/models/:model   → 移除模型，不存在返回 404

GET    /api/admin/keys            → 查看 API Key 列表（脱敏显示）
POST   /api/admin/keys            → 创建 API Key
PATCH  /api/admin/keys/:keyPrefix → 更新 API Key 配置
DELETE /api/admin/keys/:keyPrefix → 删除 API Key
```

#### API Key 鉴权

API Key 通过管理面板或 Admin API 创建，持久化在 `data/config.json` 中。所有 `/v1/*` 请求必须携带 `Authorization: Bearer <key>` 头，鉴权失败返回 401。每个 API Key 支持配置独立的模型权限和过期时间。Admin API 使用独立的管理员认证（Basic Auth 或 session token）。速率限制基于滑动窗口算法，默认每个 Key 每分钟 60 次请求。

### 5. 协议适配层

协议适配层是本方案的核心新增模块，负责在 OpenAI API 协议和 Codex SDK 调用之间做双向转换：

**入方向（请求解析）**：将 Chat Completions 的 `messages` 或 Responses API 的 `input` 统一转换为一条文本 prompt。按顺序保留所有 system/user/assistant/tool 消息，以 `[role]\n内容` 格式拼接完整多轮对话上下文，作为 `thread.run()` 的输入。

**出方向（响应封装）**：将 Codex SDK 返回的 `turn.finalResponse`（非流式）或 `ThreadEvent` 流（流式）封装为对应协议的标准响应格式。Chat Completions 封装为 `chat.completion` / `chat.completion.chunk` 对象，Responses API 封装为对应的事件流格式。

```typescript
// adapters/chat-completions.ts — 核心转换逻辑示意
function extractPrompt(messages: ChatMessage[]): string {
  // 按顺序保留所有 system/user/assistant/tool 消息，拼接完整多轮对话上下文
  return messages
    .map(m => `[${m.role}]\n${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`)
    .join('\n\n');
}

function wrapResponse(id: string, model: string, content: string): ChatCompletion {
  return {
    id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}
```

### 6. 健康检查

健康检查采用分层策略，兼顾实时性和开销：

**高频本地检查（默认每 1 分钟）**：读取 `CODEX_HOME/auth.json` 中的 `access_token`，解析 JWT payload 的 `exp` 字段判断是否即将过期（默认 5 分钟缓冲）。纯本地文件 I/O，耗时 < 1ms，零网络开销。

**低频远程检查（默认每 15 分钟）**：执行 `codex login status` 子进程，验证凭证在服务端是否仍然有效（能捕获封号、Token 撤销等本地无法感知的异常）。跳过满载账号，避免干扰正在处理的请求。远程探测并行执行（`Promise.allSettled`），带 15 秒超时。

**被动触发探测**：当请求失败时，`request-lifecycle` 会立即对该账号触发一次本地探测，无需等待定时器周期。

**容错机制**：连续失败次数达到阈值（默认 2 次）才标记为 unhealthy，避免偶发故障误杀；恢复时立即切回 healthy 状态。状态变化通过 SSE 实时推送到管理面板。

```typescript
// health-check.ts 核心结构（简化示意）
export function startHealthCheck(options?: HealthCheckOptions) {
  // 高频：本地 JWT 过期检查
  const localTimer = setInterval(async () => {
    for (const entry of pool.entries()) {
      const healthy = await probeLocal(entry.codexHome, expiryBufferSec);
      await handleProbeResult(entry.accountId, healthy, failThreshold, 'local');
    }
  }, localIntervalMs);  // 默认 1 分钟

  // 低频：codex login status 远程检查（并行执行）
  const remoteTimer = setInterval(async () => {
    const entries = pool.entries().filter(e => e.activeCount < e.maxConcurrency);
    await Promise.allSettled(
      entries.map(async (entry) => {
        const healthy = await probeRemote(entry.codexHome, remoteTimeoutMs);
        await handleProbeResult(entry.accountId, healthy, failThreshold, 'remote');
      }),
    );
  }, remoteIntervalMs);  // 默认 15 分钟

  return { stop: () => { clearInterval(localTimer); clearInterval(remoteTimer); } };
}
```

---

## 工程结构

```
nexus-codex/
├── docs/
│   ├── design.md               # 设计方案
│   └── admin-panel.md          # 管理面板方案
├── admin-fe/                    # 管理面板前端（React + Vite + Tailwind）
│   └── src/
│       ├── components/          # UI 组件
│       ├── contexts/            # React Context（Auth、Toast）
│       └── lib/                 # 工具函数
├── public/
│   └── admin/                   # 管理面板构建产物
├── src/
│   ├── index.ts                # 入口，启动 Hono 服务
│   ├── routes/
│   │   ├── chat-completions.ts # POST /v1/chat/completions
│   │   ├── responses.ts        # POST /v1/responses
│   │   ├── models.ts           # GET /v1/models
│   │   └── admin.ts            # 管理路由（账号、模型、API Key、登录登出）
│   ├── adapters/
│   │   ├── chat-completions.ts # Chat Completions 协议适配
│   │   └── responses.ts        # Responses API 协议适配
│   ├── middleware/
│   │   ├── auth.ts             # API Key 鉴权 + Admin 认证中间件
│   │   └── rate-limit.ts       # 基于 API Key 的滑动窗口速率限制
│   ├── services/
│   │   ├── account-pool.ts     # 账号池 & 最小负载调度（含排队等待）
│   │   ├── account-store.ts    # 账号数据持久化（原子写入 + 内存缓存）
│   │   ├── admin-emitter.ts    # SSE 事件发射器（pool_changed / health_changed）
│   │   ├── config-store.ts     # 配置持久化（API Key、模型白名单、原子写入）
│   │   ├── quota-probe.ts      # 账号配额探测（调用 Codex API 查询剩余额度）
│   │   ├── session-manager.ts  # 管理面板 session 管理
│   │   ├── session-store.ts    # Codex 会话状态管理
│   │   └── health-check.ts     # 分层健康检查（本地 JWT + 远程 login status）
│   ├── utils/
│   │   ├── logger.ts           # 结构化 JSON 日志
│   │   └── request-lifecycle.ts # 请求生命周期共享函数
│   └── types.ts                # 公共类型定义
├── data/
│   ├── accounts.json           # 账号数据
│   └── config.json             # API Key、模型白名单等配置
├── package.json
└── tsconfig.json
```

---

## 关键设计决策

### 为什么做成 OpenAI API 兼容网关

原方案采用自定义 session API，虽然语义更贴合内部模型，但存在两个问题：一是上层调用方需要专门适配非标准接口，无法直接使用现有工具链；二是 Codex CLI、opencode 等工具原生支持 OpenAI API 格式，只需改一个 `base_url` 即可对接。做成 OpenAI 兼容网关后，任何支持 OpenAI API 的客户端、SDK、IDE 插件都能零成本接入，极大降低了使用门槛。

### 为什么需要同时实现两套 API

Codex CLI 新版（≥0.123.0）强制使用 `/v1/responses` 格式（`wire_api = "responses"`），而 opencode 及大多数第三方工具走的是 `/v1/chat/completions` 格式。为了同时兼容两类客户端，网关必须实现两套端点。两套端点在内部共享同一个账号池和调度逻辑，只是协议适配层不同，增量工作量可控。

### 为什么不用长驻进程池

Java 方案中需要为每个账号维护一个长驻 `codex exec` 进程，管理复杂。TypeScript SDK 内部已经处理了进程的启动和通信，每次 `thread.run()` 调用时按需启动子进程，完成后自动退出，无需手动管理进程生命周期。

### 并发控制

每个账号支持可配置的并发槽位数（`maxConcurrency`），通过 `activeCount` 计数器实现并发控制。调度策略为最小负载优先：优先选取 `activeCount` 最小的账号，同负载时轮询作为 tie-breaker。全局默认并发数通过环境变量 `DEFAULT_MAX_CONCURRENCY` 配置（默认 1，向后兼容），每个账号可独立覆盖。请求进来时若所有账号的并发槽位均已满载，进入排队等待（默认 30 秒超时，可通过 `ACQUIRE_TIMEOUT_MS` 配置）；超时后仍无可用账号，返回 `429 Too Many Requests`（符合 OpenAI API 的限流语义），由调用方决定是否重试。

### 会话超时清理

内存中的 session 需要定期清理，避免泄漏：

```typescript
// 每 10 分钟清理超过 1 小时未活跃的会话
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastActiveAt > 60 * 60 * 1000) {
      sessions.delete(id);
      pool.release(session.accountId);
    }
  }
}, 10 * 60 * 1000);
```

---

## 工作量估算

| 模块 | 工作量 |
|------|--------|
| 项目初始化（Hono + TypeScript 配置） | 0.5 天 |
| 类型定义与账号数据层 | 0.5 天 |
| 账号池 & 路由调度 | 0.5 天 |
| 会话管理 | 0.5 天 |
| Chat Completions API（协议适配 + 路由 + 流式） | 1 天 |
| Responses API（协议适配 + 路由 + 流式） | 1 天 |
| API Key 鉴权 + Models API + Admin API | 0.5 天 |
| 健康检查 | 0.5 天 |
| 错误处理与优雅关闭 | 0.5 天 |
| **合计** | **约 5.5 天** |

---

## 风险与注意事项

1. **协议兼容性**：OpenAI API 的字段非常多，不同客户端依赖的字段子集不同。初期只需实现核心字段（messages、stream、choices 等），遇到具体客户端报错再逐步补全。
2. **Responses API 复杂度**：Responses API 比 Chat Completions 更复杂（事件类型多、支持 tool_calls 等），初期可只实现文本对话的基本流程，tool_calls 等高级特性后续按需补充。
3. **Token 自动刷新**：SDK 内部会处理 OAuth Token 刷新，但需确保 `CODEX_HOME` 目录有写权限。
4. **账号限流**：Plus 账号有每日/每小时使用限额，健康检查频率不宜过高（建议 5 分钟一次），避免消耗配额。
5. **进程泄漏**：SDK 内部管理子进程，但若服务异常退出，需确保 `SIGTERM` 信号处理正确，优雅关闭所有子进程。
6. **OpenAI 服务条款**：多账号池属于灰色地带，建议仅用于个人/团队内部，不对外提供商业服务。
