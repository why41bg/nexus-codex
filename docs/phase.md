# Nexus Codex 实现阶段规划

本文档将 Nexus Codex 从 0 到 1 的完整实现路径拆分为多个渐进式 Phase。每个 Phase 产出可运行、可验证的最小增量，后一个 Phase 始终建立在前一个 Phase 的基础上。

---

## Phase 1：项目脚手架初始化 ✅

**目标**：搭建工程骨架，确保 TypeScript 编译、开发热重载、基础 HTTP 服务可运行。

**具体任务**：

1. 执行 `npm init`，初始化 `package.json`。
2. 安装核心依赖：`hono`、`@hono/node-server`、`@openai/codex-sdk`、`zod`、`@hono/zod-validator`。
3. 安装开发依赖：`typescript`、`tsx`、`@types/node`。
4. 配置 `tsconfig.json`（target: ES2022, module: NodeNext, strict 模式）。
5. 创建 `src/index.ts`，启动一个最简 Hono 服务，监听 3000 端口，挂一个 `GET /health` 返回 `{ status: "ok" }`。
6. 在 `package.json` 中配置 scripts：`dev`（tsx watch）、`build`（tsc）、`start`（node dist/index.js）。
7. 创建 `data/` 目录和空的 `accounts.json`（初始为 `[]`）。

**验收标准**：`npm run dev` 启动后，`curl http://localhost:3000/health` 返回 200。

---

## Phase 2：类型定义与账号数据层 ✅

**目标**：定义公共类型，实现账号数据的读取和持久化。

**具体任务**：

1. 创建 `src/types.ts`，定义核心接口：
   - `Account`：id, codexHome, enabled, healthy, remark, usageCount, lastUsedAt。
   - `PoolEntry`：accountId, codex, busy, healthy。
   - `SessionInfo`：conversationId, accountId, thread, lastActiveAt。
   - `ChatCompletionRequest` / `ChatCompletionResponse`：Chat Completions API 的请求/响应类型。
   - `ResponsesRequest` / `ResponsesEvent`：Responses API 的请求/响应事件类型。
2. 创建 `src/services/account-store.ts`，实现对 `data/accounts.json` 的 CRUD 操作：
   - `loadAccounts()`：读取 JSON 文件，返回账号列表。
   - `saveAccounts(accounts)`：写回 JSON 文件。
   - `addAccount(codexHome, remark)`：新增账号，自动生成 id。
   - `updateAccount(id, partial)`：更新账号字段（enabled / healthy 等）。
3. 在 `data/accounts.json` 中放入一条示例数据，便于后续调试。

**验收标准**：编写简单的调用脚本，验证 CRUD 操作正确读写 JSON 文件。

---

## Phase 3：账号池与路由调度 ✅

**目标**：实现账号池核心逻辑——基于 `@openai/codex-sdk` 的多实例管理和轮询调度。

**具体任务**：

1. 创建 `src/services/account-pool.ts`，实现 `AccountPool` 类：
   - `init(accounts)`：为每个 enabled 账号创建 `Codex` 实例，构建 `PoolEntry[]`。
   - `acquire()`：轮询选取一个空闲且健康的账号，标记为 busy，返回 `PoolEntry`；无可用时返回 `null`。
   - `release(accountId)`：释放账号占用，将 busy 置为 false。
   - `getStatus()`：返回当前池状态（各账号 busy/healthy 信息），供 Admin API 使用。
   - `addEntry(account)` / `updateEntry(accountId, partial)`：运行时热更新池条目。
2. 在 `src/index.ts` 中，服务启动时读取账号数据并调用 `pool.init()` 完成初始化。

**验收标准**：服务启动日志输出池初始化成功，`getStatus()` 返回正确的账号状态列表。

---

## Phase 4：会话管理与 API Key 鉴权 ✅

**目标**：实现会话的创建/复用/清理，以及 API Key 鉴权中间件。

**具体任务**：

1. 创建 `src/services/session-store.ts`，实现 `SessionStore` 类：
   - `getOrCreateSession(accountId, codex)`：获取已有会话或创建新会话（启动 Thread），返回 SessionInfo。
   - `getSession(conversationId)`：查找并返回 SessionInfo。
   - `deleteSession(conversationId)`：删除会话，释放关联账号。
   - `touchSession(conversationId)`：更新 lastActiveAt。
2. 实现超时清理定时器：每 10 分钟扫描，清理超过 1 小时未活跃的会话，释放对应账号。
3. 创建 `src/middleware/auth.ts`，实现 API Key 鉴权中间件：
   - 从环境变量 `NEXUS_API_KEYS` 读取允许的 Key 列表（逗号分隔）。
   - 校验请求头 `Authorization: Bearer <key>`，失败返回 401 `{ error: { message: "Invalid API key", type: "invalid_request_error" } }`（OpenAI 错误格式）。
4. 在 `src/index.ts` 中将鉴权中间件挂载到 `/v1/*` 和 `/api/admin/*` 路径。

**验收标准**：不带/带错误 API Key 的请求返回 401；带正确 Key 可通过鉴权。会话可创建、查询、超时清理。

---

## Phase 5：Chat Completions API（`/v1/chat/completions`） ✅

**目标**：实现 OpenAI Chat Completions 兼容端点，支持非流式和流式响应，跑通 opencode / curl / OpenAI SDK 调用链路。

**具体任务**：

1. 创建 `src/adapters/chat-completions.ts`，实现协议适配：
   - `extractPrompt(messages)`：从 messages 数组中提取最后一条 user message，拼接 system prompt。
   - `wrapResponse(id, model, content)`：将 Codex SDK 返回的文本封装为 `chat.completion` 对象。
   - `wrapChunk(id, model, delta)`：将增量内容封装为 `chat.completion.chunk` 对象。
2. 创建 `src/routes/chat-completions.ts`，实现 `POST /v1/chat/completions` 路由：
   - 使用 Zod 校验请求体（model、messages 必填，stream 可选）。
   - 调用 `pool.acquire()` 获取账号，无可用时返回 429（OpenAI 限流语义）。
   - 非流式：调用 `thread.run(prompt)`，等待完成后返回完整的 `chat.completion` JSON。
   - 流式：调用 `thread.runStreamed(prompt)`，将 `ThreadEvent` 逐步转换为 SSE `chat.completion.chunk` 推送，最终发送 `data: [DONE]`。
3. 处理客户端提前断开连接的情况（释放账号资源）。
4. 在 `src/index.ts` 中挂载路由。

**验收标准**：

- `curl -H "Authorization: Bearer <key>" -d '{"model":"codex-plus","messages":[{"role":"user","content":"say hi"}]}' http://localhost:3000/v1/chat/completions` 返回标准 Chat Completion 响应。
- `stream: true` 时 SSE 流正常推送，以 `data: [DONE]` 结束。
- opencode 配置 `baseURL` 后可正常对话。

---

## Phase 6：Responses API（`/v1/responses`） ✅

**目标**：实现 OpenAI Responses API 兼容端点，支持 Codex CLI 通过 `wire_api = "responses"` 直接对接。

**具体任务**：

1. 创建 `src/adapters/responses.ts`，实现协议适配：
   - `extractPromptFromInput(input)`：从 Responses API 的 `input` 数组中提取用户文本（处理 `input_text` 类型）。
   - `wrapResponseObject(id, model, content)`：封装为 Responses API 的标准响应对象。
   - `buildStreamEvents(id, model, events)`：将 Codex SDK 的 `ThreadEvent` 流转换为 Responses API 的事件流格式（`response.created`、`response.output_text.delta`、`response.completed` 等）。
2. 创建 `src/routes/responses.ts`，实现 `POST /v1/responses` 路由：
   - 使用 Zod 校验请求体（model、input 必填，stream 可选）。
   - 非流式和流式逻辑与 Chat Completions 类似，但输入解析和输出封装使用 Responses 适配器。
3. 在 `src/index.ts` 中挂载路由。

**验收标准**：

- Codex CLI 配置 `base_url` 和 `wire_api = "responses"` 后，执行 `codex --provider nexus "say hi"` 能正常收到回答。
- 非流式和流式均可工作。

---

## Phase 7：Models API 与 Admin 管理接口 ✅

**目标**：实现模型列表发现端点和账号池运行时管理能力。

**具体任务**：

1. 创建 `src/routes/models.ts`，实现 `GET /v1/models`：
   - 返回固定的模型列表（`codex-plus`），格式为 OpenAI Models API 标准响应。
   - 客户端通过此接口发现可用模型。
2. 创建 `src/routes/admin.ts`，实现管理接口：
   - `GET /api/admin/accounts`：返回所有账号信息及运行时状态（busy、healthy、usageCount）。
   - `POST /api/admin/accounts`：添加新账号（codexHome + remark），写入 JSON 文件并热加载到池中。
   - `PATCH /api/admin/accounts/:id`：启用/禁用账号，更新 JSON 文件并同步池状态。
3. 在 `src/index.ts` 中挂载路由。

**验收标准**：`GET /v1/models` 返回标准模型列表。通过 Admin API 添加一个新账号，`GET /api/admin/accounts` 能看到它出现且状态正确。

---

## Phase 8：健康检查 ✅

**目标**：定时探测每个账号的可用性，自动下线失效账号，上线恢复账号。

**具体任务**：

1. 创建 `src/services/health-check.ts`，实现定时健康检查：
   - 每 5 分钟遍历池中非 busy 的账号。
   - 对每个账号启动一个临时 Thread，发送 `reply with: ok`，检查 finalResponse 是否包含 "ok"。
   - 成功则标记 `healthy: true`，失败或超时标记 `healthy: false`。
   - 状态变更时同步更新 `data/accounts.json`。
2. 增加配置项：检查间隔、探测超时时间、连续失败阈值等，便于调优。
3. 在 `src/index.ts` 中启动健康检查定时任务。

**验收标准**：手动将一个账号的 `codexHome` 指向无效路径，健康检查后该账号被自动标记为 unhealthy，不再被 `acquire()` 选中。

---

## Phase 9：错误处理与优雅关闭 ✅

**目标**：完善生产可靠性——统一错误处理、进程信号处理、优雅关闭。

**具体任务**：

1. 实现全局错误处理中间件，返回 OpenAI 标准错误格式：
   ```json
   { "error": { "message": "...", "type": "...", "code": "..." } }
   ```
   覆盖场景：429（账号池全忙）、401（鉴权失败）、404（模型不存在）、500（内部错误）。
2. 处理 `SIGTERM` / `SIGINT` 信号：
   - 停止接受新请求。
   - 等待进行中的请求完成（设置超时上限）。
   - 清理所有 session，释放池中的资源。
   - 关闭健康检查定时器。
3. 为 `thread.run()` 和 `thread.runStreamed()` 调用增加超时保护，避免单次请求无限挂起。
4. 增加请求级别的日志中间件（请求路径、耗时、状态码）。

**验收标准**：发送 `SIGTERM` 后服务优雅退出，无残留子进程；异常请求返回 OpenAI 标准错误格式。

---

## Phase 总览

| Phase | 内容 | 预估工时 | 累计 |
|-------|------|----------|------|
| 1 | 项目脚手架初始化 ✅ | 0.5 天 | 0.5 天 |
| 2 | 类型定义与账号数据层 ✅ | 0.5 天 | 1 天 |
| 3 | 账号池与路由调度 ✅ | 0.5 天 | 1.5 天 |
| 4 | 会话管理与 API Key 鉴权 ✅ | 0.5 天 | 2 天 |
| 5 | Chat Completions API ✅ | 1 天 | 3 天 |
| 6 | Responses API ✅ | 1 天 | 4 天 |
| 7 | Models API 与 Admin 管理接口 ✅ | 0.5 天 | 4.5 天 |
| 8 | 健康检查 ✅ | 0.5 天 | 5 天 |
| 9 | 错误处理与优雅关闭 ✅ | 0.5 天 | 5.5 天 |

> 总计约 5.5 天。相比原方案多出 1 天，主要用于 Chat Completions 和 Responses 两套协议适配层的实现，这是 OpenAI API 兼容网关的核心增量工作。
