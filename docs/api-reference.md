# Nexus Codex Backend API Reference

## Overview

Nexus Codex 是一个兼容 OpenAI API 的 Codex 账号池网关。后端基于 FastAPI 构建，提供以下几类接口：

- **OpenAI 兼容接口** (`/v1/*`) — 需要 API Key 认证
- **管理后台接口** (`/api/admin/*`) — 需要 Admin Session Token 认证
- **公共接口** — 无需认证

---

## 公共接口

### GET `/health`

健康检查端点。

**认证:** 无

**参数:** 无

**响应示例:**
```json
{
  "status": "ok",
  "pool": [...]
}
```

---

## OpenAI 兼容接口 (`/v1`)

> 所有 `/v1` 接口需要在请求头中携带 API Key：
> `Authorization: Bearer sk-xxxxx`

### POST `/v1/chat/completions`

Chat Completions 接口，兼容 OpenAI Chat API。

**认证:** API Key (Bearer Token)

**请求体参数:**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `model` | string | ✅ | 模型名称 |
| `messages` | array | ✅ | 消息数组 |
| `messages[].role` | string | ✅ | 角色：`system` / `user` / `assistant` / `tool` |
| `messages[].content` | string \| array \| null | ✅ | 消息内容，支持纯文本、多模态数组或 null（tool call 时） |
| `messages[].name` | string | ❌ | 可选名称 |
| `messages[].tool_calls` | array | ❌ | assistant 消息的工具调用列表 |
| `messages[].tool_call_id` | string | ❌ | tool 消息对应的工具调用 ID |
| `stream` | boolean | ❌ | 是否流式输出，默认 `false` |
| `temperature` | float | ❌ | 温度参数 |
| `max_tokens` | integer | ❌ | 最大生成 token 数 |
| `max_completion_tokens` | integer | ❌ | 最大生成 token 数（`max_tokens` 别名） |
| `reasoning_effort` | string | ❌ | 推理努力程度 |
| `tools` | array | ❌ | 工具定义列表 |
| `tool_choice` | string \| dict | ❌ | 工具选择策略（`none` / `auto` / `required` 或指定函数） |
| `top_p` | float | ❌ | nucleus sampling 参数 |
| `stop` | string \| array | ❌ | 停止词 |
| `frequency_penalty` | float | ❌ | 频率惩罚 |
| `presence_penalty` | float | ❌ | 存在惩罚 |
| `response_format` | dict | ❌ | 响应格式（`json_object` 或 `json_schema`） |
| `seed` | integer | ❌ | 随机种子 |
| `parallel_tool_calls` | boolean | ❌ | 是否允许并行工具调用 |
| `stream_options` | dict | ❌ | 流式选项（如 `{"include_usage": true}`） |
| `codex_events` | boolean | ❌ | Codex 扩展事件开关 |

**响应:** 兼容 OpenAI Chat Completion 格式（流式为 SSE `text/event-stream`）。

---

### POST `/v1/responses`

Responses API 接口，兼容 OpenAI Responses API。

**认证:** API Key (Bearer Token)

**请求体参数:**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `model` | string | ✅ | 模型名称 |
| `input` | string \| array | ✅ | 输入内容，可以是纯字符串或结构化输入数组 |
| `input[].role` | string | ✅ | 角色：`system` / `developer` / `user` |
| `input[].content` | string \| array | ✅ | 内容，可以是字符串或 ContentPart 数组 |
| `stream` | boolean | ❌ | 是否流式输出，默认 `false` |
| `temperature` | float | ❌ | 温度参数 |
| `max_output_tokens` | integer | ❌ | 最大输出 token 数 |
| `previous_response_id` | string | ❌ | 上一个 response 的 ID |
| `instructions` | string | ❌ | 系统指令 |
| `store` | boolean | ❌ | 是否存储 |
| `reasoning_effort` | string | ❌ | 推理努力程度 |
| `tools` | array | ❌ | 工具定义列表 |
| `tool_choice` | string | ❌ | 工具选择策略 |
| `parallel_tool_calls` | boolean | ❌ | 是否允许并行工具调用 |
| `codex_events` | boolean | ❌ | Codex 扩展事件开关 |

**响应:** 兼容 OpenAI Responses API 格式（流式为 SSE named events）。

---

### GET `/v1/models`

列出当前 API Key 可用的模型列表。

**认证:** API Key (Bearer Token)

**参数:** 无

**响应示例:**
```json
{
  "object": "list",
  "data": [
    { "id": "gpt-5.4", "object": "model", "created": 1700000000, "owned_by": "nexus-codex" }
  ]
}
```

---

### GET `/v1/models/{model_id}`

获取指定模型的信息。

**认证:** API Key (Bearer Token)

**路径参数:**

| 参数 | 类型 | 说明 |
|------|------|------|
| `model_id` | string | 模型 ID |

**响应示例:**
```json
{ "id": "gpt-5.4", "object": "model", "created": 1700000000, "owned_by": "nexus-codex" }
```

---

## 管理后台接口 (`/api/admin`)

> 除了 `/api/admin/login` 外，所有管理接口需要在请求头中携带 Session Token：
> `Authorization: Bearer <session_token>`

### POST `/api/admin/login`

管理员登录。

**认证:** 无

**请求体参数:**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `username` | string | ✅ | 用户名 |
| `password` | string | ✅ | 密码 |

**响应示例:**
```json
{ "token": "session_token_string" }
```

---

### POST `/api/admin/logout`

管理员登出。

**认证:** Admin Session Token

**参数:** 无

**响应示例:**
```json
{ "ok": true }
```

---

### GET `/api/admin/stream`

管理面板实时 SSE 事件流。

**认证:** Admin Session Token

**参数:** 无

**响应:** `text/event-stream`，推送 pool 状态变更等事件。

---

### GET `/api/admin/dashboard`

获取仪表盘概览数据。

**认证:** Admin Session Token

**参数:** 无

**响应示例:**
```json
{
  "total": 10,
  "totalSlots": 30,
  "activeSlots": 5,
  "availableSlots": 25,
  "unhealthy": 1,
  "disabled": 2,
  "totalUsage": 1234,
  "recentRequests1h": 50,
  "recentErrors1h": 2,
  "avgLatency1h": 1200
}
```

---

### GET `/api/admin/accounts`

列出所有账号。

**认证:** Admin Session Token

**参数:** 无

**响应示例:**
```json
{
  "accounts": [
    {
      "id": "xxx",
      "codexHome": "/path/to/home",
      "remark": "备注",
      "enabled": true,
      "usageCount": 10,
      "lastUsedAt": "2025-01-01T00:00:00Z",
      "runtime": { "healthy": true, "activeCount": 1, "maxConcurrency": 3 }
    }
  ]
}
```

---

### POST `/api/admin/accounts`

添加新账号。

**认证:** Admin Session Token

**请求体参数:**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `codexHome` | string | ✅ | Codex Home 路径 |
| `remark` | string | ❌ | 备注，默认空 |
| `maxConcurrency` | integer | ❌ | 最大并发数 |

---

### PATCH `/api/admin/accounts/{account_id}`

更新账号信息。

**认证:** Admin Session Token

**路径参数:**

| 参数 | 类型 | 说明 |
|------|------|------|
| `account_id` | string | 账号 ID |

**请求体参数:**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `enabled` | boolean | ❌ | 是否启用 |
| `healthy` | boolean | ❌ | 是否健康 |
| `remark` | string | ❌ | 备注 |
| `maxConcurrency` | integer | ❌ | 最大并发数 |

---

### DELETE `/api/admin/accounts/{account_id}`

删除账号。

**认证:** Admin Session Token

**路径参数:**

| 参数 | 类型 | 说明 |
|------|------|------|
| `account_id` | string | 账号 ID |

---

### POST `/api/admin/accounts/import`

批量导入账号。

**认证:** Admin Session Token

**请求体参数:**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `accounts` | array | ✅ | 账号列表 |
| `accounts[].codexHome` | string | ✅ | Codex Home 路径 |
| `accounts[].remark` | string | ❌ | 备注 |
| `accounts[].maxConcurrency` | integer | ❌ | 最大并发数 |
| `accounts[].enabled` | boolean | ❌ | 是否启用 |
| `mode` | string | ❌ | 导入模式：`merge`（默认）或 `replace` |

---

### GET `/api/admin/accounts/export`

导出所有账号（JSON 格式）。

**认证:** Admin Session Token

**参数:** 无

---

### GET `/api/admin/backup`

下载完整备份（账号 + 配置）。

**认证:** Admin Session Token

**参数:** 无

---

### GET `/api/admin/accounts/{account_id}/quota`

获取指定账号的配额信息。

**认证:** Admin Session Token

**路径参数:**

| 参数 | 类型 | 说明 |
|------|------|------|
| `account_id` | string | 账号 ID |

---

### POST `/api/admin/accounts/{account_id}/quota/refresh`

刷新指定账号的配额（绕过缓存）。

**认证:** Admin Session Token

**路径参数:**

| 参数 | 类型 | 说明 |
|------|------|------|
| `account_id` | string | 账号 ID |

---

### GET `/api/admin/keys`

列出所有 API Key（脱敏显示）。

**认证:** Admin Session Token

**参数:** 无

**响应示例:**
```json
{
  "keys": [
    {
      "keyMasked": "sk-1234...abcd",
      "keyPrefix": "sk-12345678",
      "name": "My Key",
      "models": [],
      "effectiveModels": ["gpt-5.4"],
      "createdAt": "2025-01-01T00:00:00Z",
      "rateLimitMax": 60,
      "rateLimitWindowMs": 60000,
      "monthlyQuota": 1000,
      "monthlyUsage": 50,
      "ipWhitelist": []
    }
  ]
}
```

---

### POST `/api/admin/keys`

创建新的 API Key。

**认证:** Admin Session Token

**请求体参数:**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `key` | string | ❌ | 自定义 Key，不填则自动生成 |
| `name` | string | ❌ | Key 名称 |
| `models` | array | ❌ | 允许使用的模型列表，空则使用默认模型 |
| `rateLimitMax` | integer | ❌ | 速率限制最大请求数 |
| `rateLimitWindowMs` | integer | ❌ | 速率限制时间窗口（毫秒） |
| `monthlyQuota` | integer | ❌ | 月度配额 |
| `ipWhitelist` | array | ❌ | IP 白名单列表 |

---

### POST `/api/admin/keys/reveal`

显示完整的 API Key（需要二次密码验证）。

**认证:** Admin Session Token

**请求体参数:**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `keyPrefix` | string | ✅ | Key 前缀 |
| `password` | string | ✅ | 管理员密码 |

**响应示例:**
```json
{ "key": "sk-full-key-string" }
```

---

### PATCH `/api/admin/keys/{key_prefix}`

更新 API Key。

**认证:** Admin Session Token

**路径参数:**

| 参数 | 类型 | 说明 |
|------|------|------|
| `key_prefix` | string | Key 前缀或完整 Key |

**请求体参数:**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | ❌ | Key 名称 |
| `models` | array | ❌ | 允许使用的模型列表 |
| `rateLimitMax` | integer | ❌ | 速率限制最大请求数 |
| `rateLimitWindowMs` | integer | ❌ | 速率限制时间窗口（毫秒） |
| `monthlyQuota` | integer | ❌ | 月度配额 |
| `ipWhitelist` | array | ❌ | IP 白名单列表 |

---

### DELETE `/api/admin/keys/{key_prefix}`

删除 API Key。

**认证:** Admin Session Token

**路径参数:**

| 参数 | 类型 | 说明 |
|------|------|------|
| `key_prefix` | string | Key 前缀或完整 Key |

---

### GET `/api/admin/models`

列出默认模型列表。

**认证:** Admin Session Token

**参数:** 无

**响应示例:**
```json
{ "models": ["gpt-5.4", "gpt-5.5", "gpt-5.4-mini", "gpt-5.3-codex", "gpt-5.2"] }
```

---

### POST `/api/admin/models`

添加默认模型。

**认证:** Admin Session Token

**请求体参数:**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `model` | string | ✅ | 模型 ID |

---

### DELETE `/api/admin/models/{model_id}`

删除默认模型。

**认证:** Admin Session Token

**路径参数:**

| 参数 | 类型 | 说明 |
|------|------|------|
| `model_id` | string | 模型 ID |

---

### GET `/api/admin/pool-status`

获取当前连接池状态。

**认证:** Admin Session Token

**参数:** 无

---

### GET `/api/admin/metrics/timeseries`

获取指标时间序列数据。

**认证:** Admin Session Token

**查询参数:**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `range` | string | ❌ | 时间范围，默认 `1h` |

---

### GET `/api/admin/metrics/breakdown`

获取指标分类统计（内存环形缓冲区，快速）。

**认证:** Admin Session Token

**参数:** 无

---

### GET `/api/admin/metrics/timeseries/persistent`

获取持久化指标时间序列数据（SQLite 存储）。

**认证:** Admin Session Token

**查询参数:**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `range` | string | ❌ | 时间范围，默认 `1h` |

---

### GET `/api/admin/metrics/breakdown/persistent`

获取持久化指标分类统计（SQLite 存储）。

**认证:** Admin Session Token

**参数:** 无

---

### GET `/api/admin/banned-ips`

列出所有被封禁的 IP。

**认证:** Admin Session Token

**参数:** 无

**响应示例:**
```json
{
  "bannedIps": [
    { "ip": "1.2.3.4", "reason": "Manually banned", "bannedAt": "2025-01-01T00:00:00Z", "hitCount": 5 }
  ]
}
```

---

### POST `/api/admin/banned-ips`

手动封禁 IP 地址。

**认证:** Admin Session Token

**请求体参数:**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `ip` | string | ✅ | IP 地址 |
| `reason` | string | ❌ | 封禁原因，默认 "Manually banned" |

---

### DELETE `/api/admin/banned-ips/{ip}`

解除 IP 封禁。

**认证:** Admin Session Token

**路径参数:**

| 参数 | 类型 | 说明 |
|------|------|------|
| `ip` | string | IP 地址 |

---

## 错误响应格式

所有接口的错误响应遵循统一格式：

```json
{
  "error": {
    "message": "错误描述信息",
    "type": "error_type",
    "code": "error_code"
  }
}
```

常见错误类型：
- `authentication_error` — 认证失败
- `invalid_request_error` — 请求参数错误
- `server_error` — 服务器内部错误
- `conflict` — 资源冲突
