# 账号池并发改造方案

## 背景

当前 Nexus Codex 的账号池采用"一账号一并发"模型：每个账号通过 `busy` 布尔标志位做互斥，同一时刻只能被一个请求占用。5 个账号的理论最大并发数为 5。

经过对 `@openai/codex-sdk` 源码的分析，SDK 层面完全支持同一个 `Codex` 实例同时运行多个 `Thread`。每次 `startThread()` 创建独立的 `Thread` 实例，每次 `run()` / `runStreamed()` 调用都会 spawn 独立的 CLI 子进程，Thread 之间不共享任何可变状态。因此，技术上可以将单账号的并发能力从 1 提升到 N。

## 目标

将账号池从"一账号一并发"改造为"一账号多并发（可配置槽位数）"，在不增加账号数量的前提下提升系统整体吞吐量。5 个账号、每账号 3 个槽位的配置下，理论最大并发可达 15。

---

## 改造范围

### 1. 类型定义 (`src/types.ts`)

`PoolEntry` 新增并发控制字段，将 `busy: boolean` 替换为槽位计数模型：

```typescript
export interface PoolEntry {
  accountId: string;
  codex: Codex;
  // busy: boolean;                  // 移除
  activeCount: number;               // 当前活跃请求数
  maxConcurrency: number;            // 该账号允许的最大并发数
  healthy: boolean;
}
```

`Account` 新增可选的 `maxConcurrency` 字段，允许每个账号独立配置并发上限：

```typescript
export interface Account {
  id: string;
  codexHome: string;
  enabled: boolean;
  healthy: boolean;
  remark: string;
  usageCount: number;
  lastUsedAt: string | null;
  maxConcurrency?: number;           // 新增，默认取全局配置
}
```

### 2. 全局默认并发配置

通过环境变量 `DEFAULT_MAX_CONCURRENCY` 设置全局默认值，未单独配置的账号使用此值。默认为 `1`（向后兼容，行为与改造前一致）。

```
DEFAULT_MAX_CONCURRENCY=3
```

### 3. 账号池核心逻辑 (`src/services/account-pool.ts`)

这是改造的核心模块，变更点如下：

**初始化**：`init()` 中将 `busy: false` 替换为 `activeCount: 0` 和 `maxConcurrency`（优先取账号级配置，否则取全局默认值）。

**获取账号**：`acquire()` 的判断条件从 `!e.busy` 改为 `e.activeCount < e.maxConcurrency`，获取时执行 `entry.activeCount++` 而非 `entry.busy = true`。选取策略从简单轮询改为**最小负载优先**（选 `activeCount` 最小的账号），在并发场景下能更均匀地分配负载。

**释放账号**：`release()` 执行 `entry.activeCount--`（需做下界保护，不低于 0）。

**排队唤醒**：`drainQueue()` 逻辑不变，释放时仍然尝试唤醒队列中的等待者。

**状态快照**：`getStatus()` 返回 `activeCount` 和 `maxConcurrency` 替代 `busy`。

伪代码示意：

```typescript
const DEFAULT_MAX_CONCURRENCY = Number(process.env.DEFAULT_MAX_CONCURRENCY) || 1;

// acquire
acquire(): PoolEntry | null {
  const available = this.pool
    .filter(e => e.healthy && e.activeCount < e.maxConcurrency)
    .sort((a, b) => a.activeCount - b.activeCount);  // 最小负载优先
  if (available.length === 0) return null;
  const entry = available[0];
  entry.activeCount++;
  return entry;
}

// release
release(accountId: string): void {
  const entry = this.pool.find(e => e.accountId === accountId);
  if (entry) entry.activeCount = Math.max(0, entry.activeCount - 1);
  this.drainQueue();
}
```

### 4. 会话存储 (`src/services/session-store.ts`)

`deleteSession()` 中调用 `pool.release()` 的逻辑不变，因为 `release()` 的语义已从"解除 busy"变为"activeCount 减一"，无需修改调用方。

### 5. 请求生命周期 (`src/utils/request-lifecycle.ts`)

`acquireAccount()`、`initRequestContext()`、`releaseRequestContext()`、`releaseAccountOnError()` 的调用方式不变，因为它们都是通过 `pool.acquire()` / `pool.release()` 间接操作，接口语义保持一致。

### 6. 健康检查 (`src/services/health-check.ts`)

当前健康检查跳过 `busy` 账号的逻辑需要调整。改造后，一个账号可能有部分槽位在使用但仍有空闲槽位。建议改为：跳过已满载（`activeCount >= maxConcurrency`）的账号，对有空闲槽位的账号正常探测。

```typescript
// 改造前
if (entry.busy) continue;

// 改造后
if (entry.activeCount >= entry.maxConcurrency) continue;
```

### 7. 管理面板 API (`src/routes/admin.ts`)

Dashboard 和账号列表接口需要返回新的并发状态字段：

```json
{
  "accountId": "acc-1",
  "activeCount": 2,
  "maxConcurrency": 3,
  "healthy": true
}
```

添加/编辑账号时支持设置 `maxConcurrency` 字段。

### 8. 管理面板前端 (`admin-fe/`)

账号列表表格中，将原来的 `busy` 状态列替换为并发占用展示，例如 `2 / 3`（当前活跃 / 最大并发）。Dashboard 概览卡片中展示总并发容量和当前使用量。添加/编辑账号表单中增加 `maxConcurrency` 输入项。

### 9. 数据文件 (`data/accounts.json`)

现有账号数据无需强制迁移。`maxConcurrency` 字段为可选，缺失时使用全局默认值，保证向后兼容。

---

## 调度策略

改造后的调度策略从"轮询选取空闲账号"变为"最小负载优先"：

1. 过滤出所有健康且未满载的账号（`healthy && activeCount < maxConcurrency`）
2. 按 `activeCount` 升序排序，选取负载最低的账号
3. 如果多个账号负载相同，可保留轮询逻辑作为 tie-breaker，避免总是命中同一个账号

这种策略能在并发场景下更均匀地分配请求，避免某个账号被集中打满而其他账号空闲。

---

## 风险与注意事项

**OpenAI 账号级速率限制**：虽然 SDK 支持多 Thread 并发，但 OpenAI 对单个 Plus 账号可能存在 API 级别的速率限制（如每分钟请求数、每日 token 用量等）。`maxConcurrency` 的值不宜设置过高，建议初始值设为 3，根据实际运行情况调整。

**系统资源消耗**：每个并发请求都会 spawn 一个独立的 Codex CLI 子进程。如果 5 个账号各开 3 个并发，峰值可能同时有 15 个子进程在运行，需关注服务器的 CPU 和内存使用情况。

**向后兼容**：`DEFAULT_MAX_CONCURRENCY` 默认值为 1，不设置环境变量时行为与改造前完全一致，零风险升级。

**竞态安全**：Node.js 单线程事件循环天然避免了 `activeCount` 的竞态问题，`acquire()` 和 `release()` 的读写操作在同一个 tick 内完成，无需加锁。

---

## 实施步骤

| 步骤 | 内容 | 预估工作量 |
|------|------|-----------|
| 1 | 修改 `types.ts`，新增 `activeCount` / `maxConcurrency` 字段 | 0.5h |
| 2 | 改造 `account-pool.ts` 核心调度逻辑 | 1h |
| 3 | 适配 `health-check.ts` 跳过条件 | 0.5h |
| 4 | 适配 `admin.ts` 管理接口，支持新字段的读写 | 1h |
| 5 | 适配 `account-store.ts`，持久化 `maxConcurrency` | 0.5h |
| 6 | 前端 `admin-fe/` 展示并发状态、支持配置 | 1.5h |
| 7 | 端到端测试：多并发请求验证调度正确性 | 1h |
| **合计** | | **约 6h** |

---

## 验证方案

1. **单元验证**：对改造后的 `AccountPool` 编写测试，验证 acquire/release 在多并发场景下的计数正确性、最小负载选取逻辑、满载后排队/超时行为。

2. **集成验证**：启动服务后，使用多个并发客户端同时发送请求，观察日志确认同一账号被分配了多个并发请求，且 `activeCount` 正确递增/递减。

3. **压力验证**：将 `maxConcurrency` 设为 3，用 5 个账号同时发起 15 个并发请求，确认全部正常处理；发起第 16 个请求时确认进入排队或返回 429。

4. **兼容性验证**：不设置 `DEFAULT_MAX_CONCURRENCY` 环境变量，确认行为与改造前一致（每账号最多 1 个并发）。
