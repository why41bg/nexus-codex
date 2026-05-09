# Nexus Codex 客户端配置指南

本文档介绍如何配置 Codex CLI 和 opencode 客户端，使其通过 Nexus Codex 账号池网关访问 OpenAI API。

## 前置条件

1. **Nexus Codex 服务已启动** — 假设服务运行在 `http://localhost:3000`（如果是远程部署，替换为实际地址）
2. **已创建 API Key** — 通过管理面板或 Admin API 创建，例如 `sk-key1`
3. **已配置模型白名单** — 确认你要使用的模型已在管理面板中添加

验证服务可用：

```bash
curl -H "Authorization: Bearer sk-key1" http://localhost:3000/v1/models
```

---

## Codex CLI 配置

Codex CLI 通过 `~/.codex/config.toml` 配置自定义 provider。

### 1. 编辑配置文件

在 `~/.codex/config.toml` 中添加：

```toml
# 默认使用的模型
model = "codex-mini"

# 默认使用的 provider
model_provider = "nexus"

# 自定义 provider 定义
[model_providers.nexus]
# Nexus Codex 的 OpenAI 兼容 API 地址
base_url = "http://localhost:3000/v1"
# 使用 Responses API（推荐），也可用 "chat" 使用 Chat Completions API
wire_api = "responses"
# 环境变量名，Codex CLI 会从此环境变量读取 API Key
env_key = "NEXUS_API_KEY"
```

### 2. 配置项说明

| 配置项 | 说明 | 可选值 |
|--------|------|--------|
| `model` | 默认使用的模型 ID | 管理面板中配置的任意模型，如 `codex-mini`、`gpt-5.4` |
| `model_provider` | 默认 provider 名称 | 自定义名称，需与 `[model_providers.<name>]` 一致 |
| `base_url` | API 端点地址 | Nexus Codex 服务地址 + `/v1` |
| `wire_api` | 使用的 API 协议 | `"responses"`（Responses API）或 `"chat"`（Chat Completions API） |
| `env_key` | API Key 环境变量名 | 任意环境变量名，如 `NEXUS_API_KEY` |

### 3. 设置环境变量并运行

```bash
export NEXUS_API_KEY="sk-key1"
codex --provider nexus "你的问题"
```

### 4. 多 Provider 切换

如果你有多个 Nexus Codex 实例或想使用不同模型，可以配置多个 provider：

```toml
model_provider = "nexus"

[model_providers.nexus]
base_url = "http://localhost:3000/v1"
wire_api = "responses"
env_key = "NEXUS_API_KEY"

[model_providers.nexus-chat]
base_url = "http://localhost:3000/v1"
wire_api = "chat"
env_key = "NEXUS_API_KEY"
```

切换 provider：

```bash
codex --provider nexus-chat --model gpt-5.4 "你的问题"
```

### 5. 持久化环境变量

将 API Key 写入 shell 配置文件避免每次手动 export：

```bash
# ~/.zshrc 或 ~/.bashrc
export NEXUS_API_KEY="sk-key1"
```

---

## opencode 配置

opencode 通过项目根目录的 `opencode.json` 配置自定义 provider。

### 1. 创建配置文件

在项目根目录创建 `opencode.json`：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "nexus": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Nexus Codex",
      "options": {
        "baseURL": "http://localhost:3000/v1",
        "apiKey": "sk-key1"
      },
      "models": {
        "codex-mini": {
          "name": "Codex Mini"
        },
        "gpt-5.4": {
          "name": "GPT 5.4"
        },
        "gpt-5.5": {
          "name": "GPT 5.5"
        }
      }
    }
  }
}
```

### 2. 配置项说明

| 配置项 | 说明 |
|--------|------|
| `provider.<name>` | 自定义 provider ID，如 `nexus`，可任意命名 |
| `npm` | 固定使用 `@ai-sdk/openai-compatible`（Chat Completions API） |
| `name` | 在 opencode UI 中显示的 provider 名称 |
| `options.baseURL` | Nexus Codex 服务地址 + `/v1` |
| `options.apiKey` | API Key，支持明文或 `{env:VAR_NAME}` 环境变量语法 |
| `models` | 可用模型映射，key 为模型 ID，`name` 为显示名称 |

### 3. 使用环境变量（推荐）

避免在配置文件中硬编码 API Key：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "nexus": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Nexus Codex",
      "options": {
        "baseURL": "http://localhost:3000/v1",
        "apiKey": "{env:NEXUS_API_KEY}"
      },
      "models": {
        "codex-mini": {
          "name": "Codex Mini"
        }
      }
    }
  }
}
```

然后设置环境变量：

```bash
export NEXUS_API_KEY="sk-key1"
```

### 4. 启动 opencode

```bash
cd your-project  # 进入包含 opencode.json 的目录
opencode
```

在 opencode 中使用 `/models` 命令即可看到 Nexus Codex 提供的模型列表。

### 5. 模型上下文限制

如果你的模型有特定的上下文窗口限制，可以在 `models` 中配置：

```json
"models": {
  "codex-mini": {
    "name": "Codex Mini",
    "limit": {
      "context": 200000,
      "output": 65536
    }
  }
}
```

---

## 验证配置

### 验证 Codex CLI

```bash
export NEXUS_API_KEY="sk-key1"
codex --provider nexus --model codex-mini "Say hello in Chinese"
```

### 验证 opencode

```bash
curl -H "Authorization: Bearer sk-key1" http://localhost:3000/v1/models
```

确认返回的模型列表包含你在 `opencode.json` 中配置的模型 ID。

---

## 常见问题

### Q: Codex CLI 报 "No such provider" 错误

确认 `~/.codex/config.toml` 中 `model_provider` 的值与 `[model_providers.<name>]` 的名称一致。

### Q: opencode 看不到自定义模型

1. 确认 `opencode.json` 在项目根目录
2. 确认 `models` 中的 key 与 `GET /v1/models` 返回的 `id` 一致
3. 重启 opencode 后使用 `/models` 命令刷新

### Q: 如何切换 Chat Completions 和 Responses API

- **Codex CLI**: 修改 `wire_api` 为 `"chat"` 或 `"responses"`
- **opencode**: `@ai-sdk/openai-compatible` 使用 Chat Completions API；如需 Responses API，使用 `@ai-sdk/openai` 并配置 `baseURL`

### Q: 远程部署如何配置

将 `base_url` / `baseURL` 中的 `localhost:3000` 替换为实际的远程地址，例如：

- Codex CLI: `base_url = "https://nexus.yourdomain.com/v1"`
- opencode: `"baseURL": "https://nexus.yourdomain.com/v1"`