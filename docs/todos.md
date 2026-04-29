# Nexus Codex 审查修复计划

> 生成时间：2026-04-28
> 基于全量代码审查，按优先级和可并行度组织。每个批次内的任务相互独立，可同时进行。

---

## 批次 1 — 关键安全与数据完整性（P1）

这些问题涉及数据丢失风险和安全漏洞，应最优先处理。

### 1.1 `config-store.ts` 补齐原子写入和写入互斥锁

- **文件**：`src/services/config-store.ts`（`saveConfig` 方法）
- **问题**：`account-store.ts` 已使用 write-to-tmp + rename 原子写入策略和 Promise 链互斥锁，但 `config-store.ts` 的 `saveConfig` 直接 `writeFile` 覆盖原文件。进程崩溃时 `config.json` 可能被截断为空，丢失所有 API Key 和模型配置。
- **修复**：参照 `account-store.ts` 的 `saveAccounts` 实现，加入 write-to-tmp + rename + Promise 链互斥锁。
- [x] 完成

### 1.2 修复 `verifyAdminAuth` 时序攻击残留

- **文件**：`src/services/config-store.ts`（`verifyAdminAuth` 方法，约第 153-167 行）
- **问题**：当 `expectedUser.length !== inputUser.length` 时直接 `return false`，跳过了 `timingSafeEqual`，攻击者可通过响应时间差推断凭据长度。
- **修复**：在比较前先对输入做 HMAC/hash 归一化到固定长度，再执行 `timingSafeEqual`；或对齐到相同长度 buffer 后比较。
- [x] 完成

### 1.3 修复 Rate Limiter 内存泄漏

- **文件**：`src/middleware/rate-limit.ts`（`requestStore` Map）
- **问题**：`requestStore` 只在请求到来时清理过期时间戳，从不删除空条目。已删除/不活跃的 API Key 条目会永驻内存。
- **修复**：在 `cleanupTimestamps` 返回空数组时 `delete` 该 Key 条目；可选地添加定期扫描清理（如每 10 分钟）。
- [x] 完成

### 1.4 修复前端 Token 双重存储问题

- **文件**：`admin-fe/src/contexts/AuthContext.tsx`（第 44-46 行），`admin-fe/src/lib/api.ts`
- **问题**：`api.ts` 注释声称使用 `sessionStorage` 提高安全性，但 `AuthContext` 同时将 token 存入 `localStorage`，完全抵消了安全优势。
- **修复**：统一存储策略——要么只用 `localStorage`（删除 `api.ts` 中的安全性声明），要么只用 `sessionStorage`（删除 `localStorage` 写入），或改用 HttpOnly cookie 方案。
- [x] 完成

### 1.5 提取前端重复函数到共享模块

- **文件**：`admin-fe/src/components/AccountDetailModal.tsx`、`admin-fe/src/components/AccountTable.tsx`
- **问题**：`getAccountStatus`、`formatResetsIn`、`quotaBarColor` 三个函数在两个文件中完全重复。
- **修复**：提取到 `admin-fe/src/lib/account-utils.ts`，两个组件改为 import 引用。
- [x] 完成

---

## 批次 2 — 后端性能与健壮性优化（P2）

以下任务相互独立，可并行修复。

### 2.1 `account-store.ts` 加入内存缓存

- **文件**：`src/services/account-store.ts`（`loadAccounts` 方法）
- **问题**：每次调用都从磁盘读取 `accounts.json` 并 `JSON.parse`，在 admin 多个端点中被频繁调用。
- **修复**：维护内存缓存变量，仅在 `saveAccounts` 后更新缓存，`loadAccounts` 优先读缓存。
- [x] 完成

### 2.2 `quota-probe.ts` 改用异步文件读取

- **文件**：`src/services/quota-probe.ts`（`readAccessToken` 方法，约第 65-75 行）
- **问题**：使用 `readFileSync` 同步读取 auth.json，高并发下会阻塞事件循环。
- **修复**：改为 `await readFile()`，对应调用方也改为 async。
- [x] 完成

### 2.3 Admin Session 添加定期清理

- **文件**：`src/services/session-manager.ts`
- **问题**：sessions Map 只在 `validateSession` 时被动删除过期 session，未访问的 session 永驻内存。
- **修复**：参照 `session-store.ts` 的 `startSessionCleanup`，添加定期扫描清理过期 session 的机制。
- [x] 完成

### 2.4 健康检查远程探测改为并行执行

- **文件**：`src/services/health-check.ts`（远程探测循环，约第 188-203 行）
- **问题**：`probeRemote` 在 for 循环中逐个 await，10 个账号最坏需 150 秒。
- **修复**：使用 `Promise.allSettled` 并行执行（可选加 concurrency limit）。
- [x] 完成

### 2.5 SSE Header 设置移到 `stream()` 外部

- **文件**：`src/routes/chat-completions.ts`、`src/routes/responses.ts`
- **问题**：SSE 相关 header 在 `stream(c, async (s) => { ... })` 回调内部通过 `c.header()` 设置，此时 response 可能已开始发送。
- **修复**：将 `Content-Type`、`Cache-Control` 等 header 设置移到 `stream()` 调用之前。
- [x] 完成

### 2.6 移除未使用的 `QueueItem.reject` 字段

- **文件**：`src/services/account-pool.ts`（`QueueItem` 接口，约第 13-17 行）
- **问题**：`reject` 字段定义后从未被赋值或调用，属于死代码。
- **修复**：移除 `reject` 字段，或在超时时调用 `reject` 以便调用方区分超时和正常无可用账号。
- [x] 完成

### 2.7 统一两个适配器的多轮对话处理

- **文件**：`src/adapters/responses.ts`（`extractPromptFromInput`）
- **问题**：只保留最后一条 user message（覆盖式赋值），而 `chat-completions` 适配器保留所有消息。多轮对话场景下会丢失上下文。
- **修复**：改为拼接所有 user message，与 chat-completions 适配器行为一致。
- [x] 完成

### 2.8 解耦 `logger.ts` 与 `account-pool.ts` 的循环依赖

- **文件**：`src/utils/logger.ts`、`src/services/account-pool.ts`
- **问题**：`logger.ts` 导入 `pool`（来自 `account-pool.ts`），`account-pool.ts` 又导入 `logger.ts`，形成循环依赖。
- **修复**：让 `logAcquire`/`logRelease` 接受 pool 状态快照作为参数，而非直接导入 pool 实例。
- [x] 完成

---

## 批次 3 — 前端体验与健壮性优化（P2）

以下任务相互独立，可并行修复。

### 3.1 SSE 事件刷新添加 debounce

- **文件**：`admin-fe/src/components/DashboardPage.tsx`（约第 85 行）
- **问题**：每次 SSE 事件都触发 4 个 API 并发请求的全量刷新。批量操作时可能引发请求风暴。
- **修复**：对 `refreshRef.current()` 调用添加 debounce（建议 500ms），合并短时间内的多次事件。
- [x] 完成

### 3.2 `EditKeyModal` 补充可访问性支持

- **文件**：`admin-fe/src/components/EditKeyModal.tsx`（约第 67-72 行）
- **问题**：其他三个 Modal 都实现了 `role="dialog"`、`aria-modal`、`aria-labelledby`、Escape 键关闭和焦点管理，但 EditKeyModal 完全缺失。
- **修复**：参照 `ConfirmModal` / `EditAccountModal` 补充 ARIA 属性、键盘事件处理和焦点初始化。
- [x] 完成

### 3.3 修复 `api()` 中不安全的 `{} as T` 类型断言

- **文件**：`admin-fe/src/lib/api.ts`（约第 41-43 行）
- **问题**：JSON 解析失败时返回 `{} as T`，调用方拿到空对象但类型系统声称是完整的 `T`，运行时会出现 undefined 属性访问。
- **修复**：返回类型改为 `T | null`，或让返回结构包含解析状态标志。调用方相应处理。
- [x] 完成

### 3.4 `ConfirmModal` 的 `titleId` 改为动态生成

- **文件**：`admin-fe/src/components/ConfirmModal.tsx`（第 29 行）
- **问题**：`titleId` 硬编码为 `'confirm-modal-title'`，多实例并存时违反 HTML 唯一 id 规范。
- **修复**：使用 React 的 `useId()` 钩子生成唯一 id。
- [x] 完成

### 3.5 `api()` 仅在有 body 时设置 Content-Type

- **文件**：`admin-fe/src/lib/api.ts`
- **问题**：GET、DELETE 等无 body 请求也设置了 `Content-Type: application/json`，可能引起某些中间件的意外行为。
- **修复**：仅在 `opts.body` 存在时添加 `Content-Type` header。
- [x] 完成

---

## 批次 4 — 文档同步更新（P2）

以下文档修改相互独立，可并行处理。**建议在批次 1-3 的代码修复完成后进行，确保文档与最新代码一致。**

### 4.1 修复 README 中不存在的 `npm run dev` 命令

- **文件**：`README.md`（第 80-84 行），`package.json`
- **问题**：README 推荐 `npm run dev` 但 `package.json` 无此脚本。
- **修复**：在 `package.json` 中添加 `dev` 脚本（如 `"dev": "tsc --watch & node --watch dist/index.js"` 或使用 `tsx`），或修改 README 说明。
- [x] 完成

### 4.2 补全 README 环境变量表

- **文件**：`README.md`（环境变量表），`.env.example`
- **问题**：缺少 `ADMIN_SESSION_TTL_MS`、`LOG_FORMAT`、`QUOTA_CACHE_TTL_MS` 三个实际使用的环境变量。
- **修复**：在 README 环境变量表和 `.env.example` 中补充这三个变量的说明和默认值。
- [x] 完成

### 4.3 移除或标注 API Key 过期时间功能

- **文件**：`README.md`（第 194 行），`docs/admin-panel.md`（第 80、108 行）
- **问题**：文档描述了 API Key "过期时间"配置功能，但代码中 `ApiKeyEntry` 接口和认证中间件均未实现此功能。
- **修复**：在相关描述处标注"（计划中，尚未实现）"，或直接移除相关描述。
- [x] 完成

### 4.4 重写 `design.md` 健康检查章节

- **文件**：`docs/design.md`（第 496-512 行）
- **问题**：描述的是 `thread.run('reply with: ok')` 方案，实际已改为分层 JWT 本地检查 + `codex login status` 远程探测。
- **修复**：按当前 `src/services/health-check.ts` 的实现重写此章节，说明高频本地检查（1min）+ 低频远程检查（15min）+ 被动触发探测的分层策略。
- [x] 完成

### 4.5 补充未文档化的 Admin API 端点

- **文件**：`docs/admin-panel.md`
- **问题**：以下端点未记录——`GET /api/admin/stream`（SSE 实时推送）、`GET /api/admin/accounts/:id/quota`（配额查询）、`POST /api/admin/accounts/:id/quota/refresh`（强制刷新配额）。`PATCH /api/admin/accounts/:id` 实际支持 4 个字段但文档只提了 `enabled`。
- **修复**：补充上述端点的文档，包括请求/响应格式、认证方式、使用示例。同时更新 PATCH 的字段说明。
- [x] 完成

### 4.6 补充 `config.json` 中 `adminAuth` 的说明

- **文件**：`README.md` 或 `docs/admin-panel.md`
- **问题**：管理员凭据可通过 `config.json` 的 `adminAuth` 字段持久化，与环境变量存在优先级关系，但文档未提及。
- **修复**：说明 `config.json.adminAuth` 的作用，明确"环境变量仅在首次创建默认配置时生效，之后以 config.json 为准"的优先级逻辑。
- [x] 完成

### 4.7 更新 `design.md` 工程结构和并发控制描述

- **文件**：`docs/design.md`
- **问题**：工程结构树缺少 `admin-emitter.ts` 和 `quota-probe.ts`；并发控制描述为"直接返回 429"，实际已改为排队等待后超时才返回 429；`PoolEntry` 接口缺少 `codexHome` 字段。
- **修复**：更新工程结构树、并发控制描述、PoolEntry 接口定义。
- [x] 完成

### 4.8 更新 `admin-panel.md` 数据刷新策略描述

- **文件**：`docs/admin-panel.md`（第 114 行），`README.md`（第 191 行）
- **问题**：描述"30 秒自动轮询刷新"，实际已改为 SSE 实时推送驱动刷新。
- **修复**：更新为"通过 SSE 实时事件推送驱动数据刷新"。
- [x] 完成

---

## 批次 5 — 低优先级改进（P3）

非紧急，有空时逐步完善即可。

### 5.1 账号 ID 增加熵值

- **文件**：`src/services/account-store.ts`（`addAccount`，约第 54 行）
- **问题**：`randomUUID().slice(0, 8)` 只有 32 bit 熵，大量账号时碰撞概率不可忽略（生日悖论）。
- **修复**：使用完整 UUID 或至少 12 个字符。
- [x] 完成

### 5.2 前端添加路由管理

- **文件**：`admin-fe/src/components/DashboardPage.tsx` 及相关组件
- **问题**：Tab 切换通过 `useState` 管理，无法通过 URL 直达特定 Tab，刷新丢失状态。
- **修复**：使用 URL hash 或 `react-router` 管理导航状态。
- [x] 完成

### 5.3 前端添加 ESLint / Prettier 配置

- **文件**：`admin-fe/` 根目录
- **问题**：缺少代码质量和格式化工具配置。
- **修复**：添加 `.eslintrc` 和 `.prettierrc`，在 `devDependencies` 中加入相应包。
- [x] 完成

### 5.4 所有 Modal 实现焦点陷阱

- **文件**：`admin-fe/src/components/` 下所有 Modal 组件
- **问题**：Modal 打开后按 Tab 焦点可以离开 Modal 进入背景内容，违反 WAI-ARIA 规范。
- **修复**：引入焦点陷阱逻辑，或改用原生 `<dialog>` 元素。
- [x] 完成

### 5.5 `relativeTime` 定时刷新

- **文件**：`admin-fe/src/components/AccountTable.tsx` 等使用 `relativeTime` 的组件
- **问题**："3 分钟前"不会自动更新为"4 分钟前"，非活跃状态下时间显示会逐渐过时。
- **修复**：添加轻量级定时刷新（如每分钟一次），或在 SSE 事件之外补充一个低频定时器。
- [x] 完成

---

## 进度追踪

| 批次 | 任务数 | 已完成 | 状态 |
|------|--------|--------|------|
| 批次 1 — P1 关键问题 | 5 | 5 | ✅ 完成 |
| 批次 2 — P2 后端优化 | 8 | 8 | ✅ 完成 |
| 批次 3 — P2 前端优化 | 5 | 5 | ✅ 完成 |
| 批次 4 — P2 文档同步 | 8 | 8 | ✅ 完成 |
| 批次 5 — P3 低优先级 | 5 | 5 | ✅ 完成 |
| **合计** | **31** | **31** | **全部完成** |
